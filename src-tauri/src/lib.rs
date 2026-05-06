use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct BackendProcesses {
    node: Option<Child>,
    python: Option<Child>,
}

/// Track whether wallpaper (click-through) mode is active
struct WallpaperState {
    enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub platform: String,
    pub release: String,
    pub arch: String,
    pub hostname: String,
    pub total_memory: u64,
    pub free_memory: u64,
    pub home_dir: String,
    pub cpus: usize,
    pub uptime: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub output: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NativeFile {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    SystemInfo {
        platform: std::env::consts::OS.to_string(),
        release: sys_info::os_release().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        hostname: sys_info::hostname().unwrap_or_default(),
        total_memory: sys_info::mem_info().map(|m| m.total).unwrap_or(0),
        free_memory: sys_info::mem_info().map(|m| m.avail).unwrap_or(0),
        home_dir: dirs_next::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        cpus: sys_info::cpu_num().unwrap_or(0) as usize,
        uptime: 0, // sys_info 0.9 removed uptime()
    }
}

#[tauri::command]
fn list_home_files() -> Vec<NativeFile> {
    let home = dirs_next::home_dir().unwrap_or_default();
    let entries = std::fs::read_dir(&home);
    match entries {
        Ok(iter) => iter
            .filter_map(|e| e.ok())
            .take(50)
            .map(|e| {
                let path = e.path();
                let is_dir = path.is_dir();
                NativeFile {
                    name: e.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_directory: is_dir,
                }
            })
            .collect(),
        Err(_) => vec![],
    }
}

#[tauri::command]
fn run_command(command: String) -> CommandResult {
    // Safety: restrict to cmd.exe /C for Windows compatibility
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", &command]).output()
    } else {
        Command::new("sh").args(["-c", &command]).output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            CommandResult {
                success: out.status.success(),
                output: if stdout.is_empty() { stderr } else { stdout },
            }
        }
        Err(e) => CommandResult {
            success: false,
            output: e.to_string(),
        },
    }
}

fn spawn_python(python_exe: &std::path::Path, api_py: &std::path::Path, work_dir: &std::path::Path) -> Option<Child> {
    let normalized_python = normalize_unc(python_exe);
    let normalized_api = normalize_unc(api_py);
    let normalized_cwd = normalize_unc(work_dir);
    println!(
        "[LumiOS] Starting GPT-SoVITS API: {} {} (cwd: {})",
        normalized_python.display(),
        normalized_api.display(),
        normalized_cwd.display(),
    );
    match Command::new(normalized_python)
        .arg(normalized_api)
        .arg("-a")
        .arg("127.0.0.1")
        .arg("-p")
        .arg("9880")
        .arg("-c")
        .arg("GPT_SoVITS/configs/tts_infer.yaml")
        .current_dir(normalized_cwd)
        .spawn()
    {
        Ok(child) => {
            println!("[LumiOS] GPT-SoVITS API PID: {}", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[LumiOS] Failed to start GPT-SoVITS API: {}", e);
            None
        }
    }
}

fn resolve_resource_dir(resource_dir: &Path, name: &str) -> PathBuf {
    let direct = resource_dir.join(name);
    if direct.exists() {
        return direct;
    }

    let staged = resource_dir.join("desktop-resources").join(name);
    if staged.exists() {
        return staged;
    }

    // NSIS bundles resources inside a _up_ subdirectory (update-ready layout)
    let nsis = resource_dir.join("_up_").join("desktop-resources").join(name);
    if nsis.exists() {
        return nsis;
    }

    // Fallback: check relative to the executable's directory (some install scenarios)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_relative = exe_dir.join(name);
            if exe_relative.exists() {
                return exe_relative;
            }
            let exe_nsis = exe_dir.join("_up_").join("desktop-resources").join(name);
            if exe_nsis.exists() {
                return exe_nsis;
            }
        }
    }

    direct
}

/// Strip Windows extended-length path prefix (\\?\) that external tools (Node.js) can't handle
fn normalize_unc(path: &Path) -> &Path {
    if let Some(s) = path.to_str() {
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return Path::new(stripped);
        }
    }
    path
}

#[tauri::command]
fn set_wallpaper_mode(
    enabled: bool,
    state: tauri::State<'_, Mutex<WallpaperState>>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let mut wallpaper = state.lock().map_err(|e| e.to_string())?;
    wallpaper.enabled = enabled;

    match window.set_ignore_cursor_events(enabled) {
        Ok(_) => println!("[LumiOS] set_ignore_cursor_events({}) succeeded", enabled),
        Err(e) => eprintln!("[LumiOS] set_ignore_cursor_events({}) FAILED: {}", enabled, e),
    }

    println!("[LumiOS] Wallpaper mode: {}", if enabled { "ON (click-through)" } else { "OFF" });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(BackendProcesses { node: None, python: None }))
        .manage(Mutex::new(WallpaperState { enabled: false }))
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            list_home_files,
            run_command,
            set_wallpaper_mode,
        ])
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_default();

            // Position window on secondary monitor if available, otherwise use primary
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(monitors) = window.available_monitors() {
                    if monitors.len() > 1 {
                        let target = &monitors[1];
                        let pos = target.position();
                        let size = target.size();
                        println!(
                            "[LumiOS] Moving to monitor {} ({}x{} @ {},{}),",
                            monitors.len(),
                            size.width,
                            size.height,
                            pos.x,
                            pos.y
                        );
                        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
                        let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
                    }
                }
                let _ = window.set_fullscreen(false);
            }

            // Ensure WebView2Loader.dll is alongside the EXE
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let dll_dest = exe_dir.join("WebView2Loader.dll");
                    if !dll_dest.exists() {
                        let dll_src = resource_dir
                            .join("desktop-resources")
                            .join("WebView2Loader.dll");
                        if dll_src.exists() {
                            println!("[LumiOS] Copying WebView2Loader.dll to EXE directory");
                            let _ = std::fs::copy(&dll_src, &dll_dest);
                        }
                    }
                }
            }

            // In dev mode, the backend is started by beforeDevCommand; skip spawning Node.js
            if cfg!(debug_assertions) {
                println!("[LumiOS] Dev mode — skipping bundled backend spawn");
            } else {
            // ... rest of spawn code unchanged

            // Spawn Node.js backend
            let dist_server = resolve_resource_dir(&resource_dir, "dist-server");
            let node_exe = dist_server.join("node.exe");
            let server_js = dist_server.join("entry.cjs");
            let server_bundle = dist_server.join("server.mjs");

            if node_exe.exists() && server_js.exists() && server_bundle.exists() {
                let normalized_node = normalize_unc(&node_exe);
                let normalized_entry = normalize_unc(&server_js);
                let normalized_cwd = normalize_unc(&dist_server);
                println!(
                    "[LumiOS] Starting backend: {} {} (cwd: {})",
                    normalized_node.display(),
                    normalized_entry.display(),
                    normalized_cwd.display(),
                );
                match Command::new(normalized_node)
                    .arg(normalized_entry)
                    .env("LUMI_DESKTOP", "1")
                    .env("HOST", "127.0.0.1")
                    .current_dir(normalized_cwd)
                    .spawn()
                {
                    Ok(child) => {
                        println!("[LumiOS] Backend PID: {}", child.id());
                        let state = app.state::<Mutex<BackendProcesses>>();
                        state.lock().unwrap().node = Some(child);
                    }
                    Err(e) => {
                        eprintln!("[LumiOS] Failed to start backend: {}", e);
                    }
                }
            } else {
                eprintln!(
                    "[LumiOS] Backend not found. node.exe: {}, entry.cjs: {}, server.mjs: {}",
                    node_exe.exists(),
                    server_js.exists(),
                    server_bundle.exists()
                );
            }

            // Spawn GPT-SoVITS Python API server
            let gpt_sovits_dir = resolve_resource_dir(&resource_dir, "gpt-sovits-src");
            let python_exe = gpt_sovits_dir.join("venv/Scripts/python.exe");
            let api_py = gpt_sovits_dir.join("api_v2.py");
            let dev_python = std::path::PathBuf::from("../gpt-sovits-src/venv/Scripts/python.exe");
            let dev_api = std::path::PathBuf::from("../gpt-sovits-src/api_v2.py");

            let python_child = if python_exe.exists() && api_py.exists() {
                spawn_python(&python_exe, &api_py, normalize_unc(&gpt_sovits_dir))
            } else if dev_python.exists() && dev_api.exists() {
                spawn_python(&dev_python, &dev_api, Path::new("../gpt-sovits-src"))
            } else {
                eprintln!(
                    "[LumiOS] GPT-SoVITS API not found at {} or {}",
                    python_exe.display(),
                    dev_python.display()
                );
                None
            };
            if let Some(child) = python_child {
                let state = app.state::<Mutex<BackendProcesses>>();
                state.lock().unwrap().python = Some(child);
            }
            } // end else (release mode spawns backend)

            // Register Alt+Space global shortcut (hide/show window)
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let window = app.get_webview_window("main").unwrap();
            let reg = app.global_shortcut();
            let _ = reg.on_shortcut("Alt+Space", move |_app, _shortcut, _event| {
                if window.is_visible().unwrap_or(true) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lumi OS")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<Mutex<BackendProcesses>>();
                let mut procs = state.lock().unwrap();
                if let Some(child) = procs.node.as_mut() {
                    println!("[LumiOS] Stopping Node backend...");
                    let _ = child.kill();
                }
                if let Some(child) = procs.python.as_mut() {
                    println!("[LumiOS] Stopping GPT-SoVITS API...");
                    let _ = child.kill();
                }
            }
        });
}
