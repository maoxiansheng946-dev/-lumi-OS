use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::Manager;

struct SpawnConfig {
    exe: PathBuf,
    entry: PathBuf,
    work_dir: PathBuf,
}

struct BackendProcesses {
    node: Option<Child>,
    python: Option<Child>,
    node_restarts: u32,
    python_restarts: u32,
    node_config: Option<SpawnConfig>,
    python_config: Option<SpawnConfig>,
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
    use sysinfo::System;
    let sys = System::new_all();
    // sysinfo reports memory in bytes; sys_info was KB. Preserve backward-compat by converting to KB.
    SystemInfo {
        platform: std::env::consts::OS.to_string(),
        release: System::long_os_version().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        hostname: System::host_name().unwrap_or_default(),
        total_memory: sys.total_memory() / 1024,
        free_memory: sys.available_memory() / 1024,
        home_dir: dirs_next::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        cpus: sys.physical_core_count().unwrap_or(1),
        uptime: System::uptime(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TempReading {
    pub label: String,
    pub celsius: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LiveStats {
    pub cpu_percent: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub memory_percent: f32,
    pub gpu_vendor: Option<String>,
    pub gpu_utilization: Option<f32>,
    pub temperatures: Vec<TempReading>,
    pub fan_speed_rpm: Option<f32>,
    pub hostname: String,
    pub uptime_seconds: u64,
}

fn detect_gpu() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("wmic");
        cmd.args([
            "path",
            "Win32_VideoController",
            "get",
            "name",
            "/format:csv",
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }
        let output = cmd.output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines().skip(2) {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let name = parts[1].trim();
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux: check lspci
        let output = Command::new("sh")
            .args(["-c", "lspci | grep -i vga | head -1 | cut -d: -f3"])
            .output();
        if let Ok(out) = output {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

#[tauri::command]
fn get_live_stats() -> LiveStats {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_all();
    std::thread::sleep(std::time::Duration::from_millis(100));
    sys.refresh_cpu_all();

    let cpu_percent = sys.global_cpu_usage();
    let total_mem = sys.total_memory() as f32;
    let used_mem = sys.used_memory() as f32;
    let mem_percent = if total_mem > 0.0 {
        (used_mem / total_mem) * 100.0
    } else {
        0.0
    };

    let gpu_vendor = detect_gpu();

    let components = sysinfo::Components::new_with_refreshed_list();
    let temperatures: Vec<TempReading> = components
        .iter()
        .filter(|c| c.temperature().is_some())
        .map(|c| TempReading {
            label: c.label().to_string(),
            celsius: c.temperature().unwrap(),
        })
        .collect();

    LiveStats {
        cpu_percent: (cpu_percent * 100.0).min(100.0),
        memory_used_gb: used_mem / 1024.0 / 1024.0 / 1024.0,
        memory_total_gb: total_mem / 1024.0 / 1024.0 / 1024.0,
        memory_percent: mem_percent,
        gpu_vendor,
        gpu_utilization: None,
        temperatures,
        fan_speed_rpm: None,
        hostname: System::host_name().unwrap_or_default(),
        uptime_seconds: System::uptime(),
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
    let now = SystemTime::now();
    let truncated: String = if command.len() > 500 {
        format!("{}... (truncated, {} bytes total)", &command[..500], command.len())
    } else {
        command.clone()
    };

    let output = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &command]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }
        cmd.output()
    } else {
        Command::new("sh").args(["-c", &command]).output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();
            eprintln!(
                "[LumiOS Audit] ts={:?} ok={} cmd={}",
                now, success, truncated
            );
            CommandResult {
                success,
                output: if stdout.is_empty() { stderr } else { stdout },
            }
        }
        Err(e) => {
            eprintln!(
                "[LumiOS Audit] ts={:?} ok=false cmd={} err={}",
                now, truncated, e
            );
            CommandResult {
                success: false,
                output: e.to_string(),
            }
        }
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
    let mut cmd = Command::new(normalized_python);
    cmd.arg(normalized_api)
        .arg("-a")
        .arg("127.0.0.1")
        .arg("-p")
        .arg("9880")
        .arg("-c")
        .arg("GPT_SoVITS/configs/tts_infer.yaml")
        .current_dir(normalized_cwd);
    match spawn_hidden(&mut cmd) {
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

/// Spawn a child process without showing a console window on Windows
fn spawn_hidden(cmd: &mut Command) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000u32); // CREATE_NO_WINDOW (no DETACHED_PROCESS — that creates new console)
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd.spawn()
}

#[tauri::command]
fn open_item(target: String) -> CommandResult {
    // Open file, folder, app, or URL with the OS default handler
    let result = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &target]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }
        cmd.output()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&target).output()
    } else {
        Command::new("xdg-open").arg(&target).output()
    };
    match result {
        Ok(out) => CommandResult {
            success: out.status.success(),
            output: format!("Opened: {}", target),
        },
        Err(e) => CommandResult {
            success: false,
            output: e.to_string(),
        },
    }
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

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ── Screen Monitoring Commands ──

#[derive(Debug, Serialize, Deserialize)]
pub struct ActiveWindowInfo {
    pub title: String,
    pub process_name: String,
    pub pid: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub window_title: String,
    pub cpu_percent: f32,
    pub memory_mb: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CaptureResult {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
fn get_active_window_info() -> ActiveWindowInfo {
    let mut title = String::new();
    let mut process_name = String::new();
    #[allow(unused_mut)]
    let mut pid: u32 = 0;

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetForegroundWindow() -> isize;
            fn GetWindowTextW(hwnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
            fn GetWindowThreadProcessId(hwnd: isize, lpdwProcessId: *mut u32) -> u32;
        }
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd != 0 {
                let mut buf: [u16; 512] = [0; 512];
                let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
                title = String::from_utf16_lossy(&buf[..len as usize]);
                GetWindowThreadProcessId(hwnd, &mut pid);
            }
        }
        if pid != 0 {
            use sysinfo::System;
            let sys = System::new_all();
            process_name = sys
                .process(sysinfo::Pid::from(pid as usize))
                .map(|p| p.name().to_string_lossy().to_string())
                .unwrap_or_default();
        }
    }
    #[cfg(target_os = "linux")]
    {
        // xdotool getactivewindow getwindowname
        if let Ok(out) = Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
        {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                title = name.clone();
                process_name = name;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args(["-e", r#"tell application "System Events" to get name of first application process whose frontmost is true"#])
            .output();
        if let Ok(out) = output {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                title = name.clone();
                process_name = name;
            }
        }
    }
    ActiveWindowInfo { title, process_name, pid }
}

#[tauri::command]
fn get_running_processes() -> Vec<ProcessInfo> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    std::thread::sleep(std::time::Duration::from_millis(50));
    sys.refresh_all();

    let mut processes: Vec<ProcessInfo> = Vec::new();
    for (pid, proc) in sys.processes() {
        let cpu = proc.cpu_usage();
        let mem = proc.memory() as f32 / 1024.0 / 1024.0; // bytes -> MB
        let name = proc.name().to_string_lossy().to_string();
        // Only include processes using >0.1% CPU or >10MB memory (reduce noise)
        if cpu > 0.1 || mem > 10.0 {
            processes.push(ProcessInfo {
                pid: pid.as_u32(),
                name,
                window_title: String::new(),
                cpu_percent: cpu,
                memory_mb: mem,
            });
        }
    }
    processes.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
    processes.truncate(50); // top 50
    processes
}

// ── Clipboard Commands ──

#[tauri::command]
fn get_clipboard_text() -> String {
    use arboard::Clipboard;
    match Clipboard::new() {
        Ok(mut clipboard) => clipboard.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    }
}

#[tauri::command]
fn set_clipboard_text(text: String) -> bool {
    use arboard::Clipboard;
    match Clipboard::new() {
        Ok(mut clipboard) => clipboard.set_text(text).is_ok(),
        Err(_) => false,
    }
}

// ── Idle Time ──

#[derive(Debug, Serialize, Deserialize)]
pub struct IdleInfo {
    pub idle_ms: u64,
    pub idle_seconds: u64,
}

#[tauri::command]
fn get_idle_time() -> IdleInfo {
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            tick_count: u32,
        }
        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
            fn GetTickCount() -> u32;
        }
        unsafe {
            let mut lii = LastInputInfo { cb_size: std::mem::size_of::<LastInputInfo>() as u32, tick_count: 0 };
            if GetLastInputInfo(&mut lii) != 0 {
                let tick = GetTickCount();
                let idle_ms = (tick.wrapping_sub(lii.tick_count)) as u64;
                return IdleInfo {
                    idle_ms,
                    idle_seconds: idle_ms / 1000,
                };
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        // xprintidle returns idle time in ms
        if let Ok(out) = Command::new("xprintidle").output() {
            if let Ok(ms) = String::from_utf8_lossy(&out.stdout).trim().parse::<u64>() {
                return IdleInfo { idle_ms: ms, idle_seconds: ms / 1000 };
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    IdleInfo { idle_ms: 0, idle_seconds: 0 };
    IdleInfo { idle_ms: 0, idle_seconds: 0 }
}

// ── System Audio Volume (winmm.dll) ──

#[tauri::command]
fn get_system_volume() -> f32 {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn waveOutGetVolume(hwo: u32, pdwVolume: *mut u32) -> u32;
        }
        unsafe {
            let mut vol: u32 = 0;
            if waveOutGetVolume(0xFFFFFFFFu32, &mut vol) == 0 {
                let left = (vol & 0xFFFF) as f32;
                let right = ((vol >> 16) & 0xFFFF) as f32;
                let avg = (left + right) / 2.0;
                return (avg / 65535.0 * 100.0).round();
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = Command::new("pactl")
            .args(["get-sink-volume", "@DEFAULT_SINK@"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for part in text.split_whitespace() {
                if part.ends_with('%') {
                    if let Ok(v) = part.trim_end_matches('%').parse::<f32>() {
                        return v;
                    }
                }
            }
        }
    }
    50.0 // fallback
}

#[tauri::command]
fn set_system_volume(level: f32) -> Result<f32, String> {
    let clamped = level.max(0.0).min(100.0);
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn waveOutSetVolume(hwo: u32, dwVolume: u32) -> u32;
        }
        let raw = ((clamped / 100.0) * 65535.0) as u32;
        let vol = raw | (raw << 16); // both channels
        unsafe {
            if waveOutSetVolume(0xFFFFFFFFu32, vol) == 0 {
                return Ok(clamped);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pactl")
            .args(["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", clamped as u32)])
            .output();
    }
    Ok(clamped) // web fallback: just report the value
}

// ── Monitor Brightness (dxva2.dll + user32.dll) ──

#[cfg(target_os = "windows")]
mod brightness_ffi {
    #[repr(C)]
    pub struct PhysicalMonitor {
        pub h_physical_monitor: isize,
        pub description: [u16; 128],
    }

    extern "system" {
        pub fn MonitorFromPoint(x: i32, y: i32, dwFlags: u32) -> isize;
        pub fn GetPhysicalMonitorsFromHMONITOR(
            h_monitor: isize,
            array_size: u32,
            array: *mut PhysicalMonitor,
        ) -> i32;
        pub fn GetMonitorBrightness(
            h_monitor: isize,
            min_brightness: *mut u32,
            current: *mut u32,
            max_brightness: *mut u32,
        ) -> i32;
        pub fn SetMonitorBrightness(h_monitor: isize, new_brightness: u32) -> i32;
        pub fn DestroyPhysicalMonitors(array_size: u32, array: *mut PhysicalMonitor) -> i32;
    }
}

#[tauri::command]
fn get_screen_brightness() -> f32 {
    #[cfg(target_os = "windows")]
    unsafe {
        use brightness_ffi::*;
        // MONITOR_DEFAULTTONEAREST = 2
        let h_monitor = MonitorFromPoint(0, 0, 2);
        if h_monitor == 0 {
            return 50.0;
        }
        let mut monitors: [PhysicalMonitor; 1] = [PhysicalMonitor {
            h_physical_monitor: 0,
            description: [0u16; 128],
        }];
        if GetPhysicalMonitorsFromHMONITOR(h_monitor, 1, monitors.as_mut_ptr()) == 0 {
            return 50.0;
        }
        let h = monitors[0].h_physical_monitor;
        if h == 0 {
            return 50.0;
        }
        let mut min: u32 = 0;
        let mut cur: u32 = 0;
        let mut max: u32 = 0;
        let result = if GetMonitorBrightness(h, &mut min, &mut cur, &mut max) != 0 {
            if max > min {
                ((cur as f32 - min as f32) / (max as f32 - min as f32) * 100.0).round()
            } else {
                50.0
            }
        } else {
            50.0
        };
        DestroyPhysicalMonitors(1, monitors.as_mut_ptr());
        return result;
    }
    #[cfg(target_os = "linux")]
    {
        // Try brightnessctl first, then fall back to sysfs
        if let Ok(out) = Command::new("brightnessctl").arg("get").output() {
            if let Ok(cur) = String::from_utf8_lossy(&out.stdout).trim().parse::<f32>() {
                if let Ok(max_out) = Command::new("brightnessctl").arg("max").output() {
                    if let Ok(max) = String::from_utf8_lossy(&max_out.stdout).trim().parse::<f32>() {
                        if max > 0.0 {
                            return ((cur / max) * 100.0).round();
                        }
                    }
                }
            }
        }
        // sysfs fallback
        if let Ok(entries) = std::fs::read_dir("/sys/class/backlight") {
            for entry in entries.flatten() {
                let base = entry.path();
                if let (Ok(max_str), Ok(cur_str)) = (
                    std::fs::read_to_string(base.join("max_brightness")),
                    std::fs::read_to_string(base.join("brightness")),
                ) {
                    if let (Ok(max), Ok(cur)) = (max_str.trim().parse::<f32>(), cur_str.trim().parse::<f32>()) {
                        if max > 0.0 {
                            return ((cur / max) * 100.0).round();
                        }
                    }
                }
            }
        }
        50.0
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    50.0
}

#[tauri::command]
fn set_screen_brightness(level: f32) -> Result<f32, String> {
    let clamped = level.max(0.0).min(100.0);
    #[cfg(target_os = "windows")]
    unsafe {
        use brightness_ffi::*;
        let h_monitor = MonitorFromPoint(0, 0, 2);
        if h_monitor == 0 {
            return Ok(clamped);
        }
        let mut monitors: [PhysicalMonitor; 1] = [PhysicalMonitor {
            h_physical_monitor: 0,
            description: [0u16; 128],
        }];
        if GetPhysicalMonitorsFromHMONITOR(h_monitor, 1, monitors.as_mut_ptr()) == 0 {
            return Ok(clamped);
        }
        let h = monitors[0].h_physical_monitor;
        if h == 0 {
            return Ok(clamped);
        }
        let mut min: u32 = 0;
        let mut _cur: u32 = 0;
        let mut max: u32 = 0;
        if GetMonitorBrightness(h, &mut min, &mut _cur, &mut max) != 0 && max > min {
            let raw = (clamped / 100.0 * (max - min) as f32) as u32 + min;
            SetMonitorBrightness(h, raw.max(min).min(max));
        }
        DestroyPhysicalMonitors(1, monitors.as_mut_ptr());
    }
    #[cfg(target_os = "linux")]
    {
        // Try brightnessctl first, then sysfs
        let pct = format!("{}%", clamped as u32);
        let bctl = Command::new("brightnessctl")
            .args(["set", &pct])
            .output();
        if bctl.is_ok() {
            return Ok(clamped);
        }
        // sysfs fallback
        if let Ok(entries) = std::fs::read_dir("/sys/class/backlight") {
            for entry in entries.flatten() {
                let base = entry.path();
                if let Ok(max_str) = std::fs::read_to_string(base.join("max_brightness")) {
                    if let Ok(max) = max_str.trim().parse::<f32>() {
                        if max > 0.0 {
                            let raw = (clamped / 100.0 * max) as u32;
                            let _ = std::fs::write(base.join("brightness"), raw.to_string());
                        }
                    }
                }
            }
        }
    }
    Ok(clamped)
}

// ── Activity Polling ──

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivitySnapshot {
    pub window: ActiveWindowInfo,
    pub idle: IdleInfo,
    pub running_process_count: usize,
}

#[tauri::command]
fn poll_activity() -> ActivitySnapshot {
    let window = get_active_window_info();
    let idle = get_idle_time();
    let processes = get_running_processes();
    ActivitySnapshot {
        window,
        idle,
        running_process_count: processes.len(),
    }
}

#[tauri::command]
fn capture_screen() -> CaptureResult {
    #[cfg(target_os = "windows")]
    {
        // Write PNG to temp file (avoids stdout truncation for ~8 MB screenshots)
        let temp_path = std::env::temp_dir().join(format!("lumi_scr_{}.png", std::process::id()));
        let temp_file = temp_path.to_string_lossy().replace('\\', "\\\\");

        let mut cmd = Command::new("powershell");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }
        let ps = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen
$w = $s.Bounds.Width; $h = $s.Bounds.Height
$b = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(0, 0, 0, 0, $b.Size)
$g.Dispose()
$b.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
Write-Output "OK|$w|$h""#,
            temp_file
        );
        let output = cmd
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let parts: Vec<&str> = text.split('|').collect();
            if parts.len() >= 3 && parts[0] == "OK" {
                if let Ok(png) = std::fs::read(&temp_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    if !png.is_empty() {
                        let b64 = base64_encode(&png);
                        return CaptureResult {
                            image_base64: b64,
                            width: parts[1].parse().unwrap_or(0),
                            height: parts[2].parse().unwrap_or(0),
                        };
                    }
                }
            }
        }
        let _ = std::fs::remove_file(&temp_path);
    }
    #[cfg(target_os = "linux")]
    {
        for tool in &["maim", "import"] {
            let args: &[&str] = if *tool == "maim" {
                &["--format=png"]
            } else {
                &["-window", "root", "png:-"]
            };
            if let Ok(png) = Command::new(tool).args(args).output() {
                if png.status.success() && !png.stdout.is_empty() {
                    // shell pipe to base64
                    let pipe = Command::new("sh")
                        .arg("-c")
                        .arg(format!("{} {} | base64 -w0", tool, args.join(" ")))
                        .output();
                    let b64_str = pipe
                        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                        .unwrap_or_default();
                    return CaptureResult {
                        image_base64: b64_str,
                        width: 0,
                        height: 0,
                    };
                }
            }
        }
        // xrandr fallback for dimensions
        if let Ok(out) = Command::new("xrandr").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains(" connected") {
                    if let Some(mode) = line.split_whitespace().nth(3) {
                        let parts: Vec<&str> = mode.split('x').collect();
                        if parts.len() == 2 {
                            return CaptureResult {
                                image_base64: String::new(),
                                width: parts[0].parse().unwrap_or(0),
                                height: parts[1].parse().unwrap_or(0),
                            };
                        }
                    }
                }
            }
        }
    }
    CaptureResult { image_base64: String::new(), width: 0, height: 0 }
}

/// Simple base64 encoder — avoids pulling in a crate for one function.
fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[char] = &[
        'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
        'a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
        '0','1','2','3','4','5','6','7','8','9','+','/',
    ];
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3F) as usize]);
        out.push(CHARS[((n >> 12) & 0x3F) as usize]);
        out.push(if chunk.len() > 1 { CHARS[((n >> 6) & 0x3F) as usize] } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[(n & 0x3F) as usize] } else { '=' });
    }
    out
}

// ── Mouse & Keyboard Input Commands (enigo crate) ──

use enigo::{Enigo, Mouse, Settings, Coordinate, Direction, Button, Keyboard, Key};

#[tauri::command]
fn mouse_move(x: f64, y: f64) -> Result<String, String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;
    enigo.move_mouse(x as i32, y as i32, Coordinate::Abs).map_err(|e| format!("mouse_move: {}", e))?;
    Ok(format!("Mouse moved to ({}, {})", x as i32, y as i32))
}

#[tauri::command]
fn mouse_click(button: String) -> Result<String, String> {
    let btn = match button.as_str() {
        "left" => Button::Left,
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => return Err(format!("Unknown button: {}. Use left/right/middle", button)),
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;
    enigo.button(btn, Direction::Click).map_err(|e| format!("mouse_click: {}", e))?;
    Ok(format!("Mouse {} click", button))
}

#[tauri::command]
fn mouse_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64, button: String) -> Result<String, String> {
    let btn = match button.as_str() {
        "left" => Button::Left,
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => return Err(format!("Unknown button: {}. Use left/right/middle", button)),
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;
    enigo.move_mouse(from_x as i32, from_y as i32, Coordinate::Abs).map_err(|e| format!("drag move to start: {}", e))?;
    enigo.button(btn, Direction::Press).map_err(|e| format!("drag press: {}", e))?;
    enigo.move_mouse(to_x as i32, to_y as i32, Coordinate::Abs).map_err(|e| format!("drag move to end: {}", e))?;
    enigo.button(btn, Direction::Release).map_err(|e| format!("drag release: {}", e))?;
    Ok(format!("Dragged from ({}, {}) to ({}, {})", from_x as i32, from_y as i32, to_x as i32, to_y as i32))
}

#[tauri::command]
fn keyboard_type(text: String) -> Result<String, String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;
    enigo.text(&text).map_err(|e| format!("keyboard_type: {}", e))?;
    Ok(format!("Typed {} characters", text.len()))
}

#[tauri::command]
fn keyboard_press(key: String) -> Result<String, String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;

    let parts: Vec<&str> = key.split('+').map(|s| s.trim()).collect();
    // Parse modifiers first, then the main key
    for &part in &parts[..parts.len().saturating_sub(1)] {
        match part {
            "ctrl" | "control" => enigo.key(Key::Control, Direction::Press).map_err(|e| format!("ctrl press: {}", e))?,
            "shift" => enigo.key(Key::Shift, Direction::Press).map_err(|e| format!("shift press: {}", e))?,
            "alt" => enigo.key(Key::Alt, Direction::Press).map_err(|e| format!("alt press: {}", e))?,
            "meta" | "win" | "cmd" | "super" => enigo.key(Key::Meta, Direction::Press).map_err(|e| format!("meta press: {}", e))?,
            _ => return Err(format!("Unknown modifier: {}. Use ctrl/shift/alt/meta", part)),
        }
    }

    let main_key = *parts.last().unwrap_or(&"");
    let key_enum = match main_key {
        "enter" | "return" => Key::Return,
        "escape" | "esc" => Key::Escape,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" => Key::PageUp,
        "pagedown" | "pgdn" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "f1" => Key::F1, "f2" => Key::F2, "f3" => Key::F3, "f4" => Key::F4,
        "f5" => Key::F5, "f6" => Key::F6, "f7" => Key::F7, "f8" => Key::F8,
        "f9" => Key::F9, "f10" => Key::F10, "f11" => Key::F11, "f12" => Key::F12,
        _ if main_key.len() == 1 => {
            let ch = main_key.chars().next().unwrap();
            if ch.is_ascii_alphanumeric() || ",./;'[]\\-=".contains(ch) {
                Key::Unicode(ch)
            } else {
                return Err(format!("Unknown key: {}. Use a single character or named key like enter/escape/tab", main_key));
            }
        }
        _ => return Err(format!("Unknown key: {}. Use names (enter/escape/tab/up/down/etc) or a single character", main_key)),
    };

    enigo.key(key_enum, Direction::Click).map_err(|e| format!("key press '{}': {}", main_key, e))?;

    // Release modifiers in reverse order
    for &part in parts.iter().rev().skip(1) {
        match part {
            "ctrl" | "control" => { let _ = enigo.key(Key::Control, Direction::Release); }
            "shift" => { let _ = enigo.key(Key::Shift, Direction::Release); }
            "alt" => { let _ = enigo.key(Key::Alt, Direction::Release); }
            "meta" | "win" | "cmd" | "super" => { let _ = enigo.key(Key::Meta, Direction::Release); }
            _ => {}
        }
    }

    Ok(format!("Pressed key: {}", key))
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(BackendProcesses { node: None, python: None, node_restarts: 0, python_restarts: 0, node_config: None, python_config: None }))
        .manage(Mutex::new(WallpaperState { enabled: false }))
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_live_stats,
            list_home_files,
            run_command,
            open_item,
            set_wallpaper_mode,
            minimize_window,
            toggle_maximize_window,
            close_window,
            get_active_window_info,
            get_running_processes,
            capture_screen,
            get_clipboard_text,
            set_clipboard_text,
            get_idle_time,
            poll_activity,
            get_system_volume,
            set_system_volume,
            get_screen_brightness,
            set_screen_brightness,
            mouse_move,
            mouse_click,
            mouse_drag,
            keyboard_type,
            keyboard_press,
        ])
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_default();

            // Center window on primary monitor
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.center();
            }

            // Ensure WebView2Loader.dll is alongside the EXE (Windows only)
            #[cfg(target_os = "windows")]
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
            #[cfg(target_os = "windows")]
            let node_bin = dist_server.join("node.exe");
            #[cfg(not(target_os = "windows"))]
            let node_bin = dist_server.join("node");
            let server_js = dist_server.join("entry.cjs");
            let server_bundle = dist_server.join("server.mjs");

            if node_bin.exists() && server_js.exists() && server_bundle.exists() {
                let normalized_node = normalize_unc(&node_bin);
                let normalized_entry = normalize_unc(&server_js);
                let normalized_cwd = normalize_unc(&dist_server);
                println!(
                    "[LumiOS] Starting backend: {} {} (cwd: {})",
                    normalized_node.display(),
                    normalized_entry.display(),
                    normalized_cwd.display(),
                );
                let mut node_cmd = Command::new(&normalized_node);
                node_cmd.arg(&normalized_entry)
                    .env("LUMI_DESKTOP", "1")
                    .env("HOST", "127.0.0.1")
                    .current_dir(&normalized_cwd);
                // Only set NODE_OPTIONS if hide-console.cjs exists (Windows only)
                #[cfg(target_os = "windows")]
                if normalized_cwd.join("hide-console.cjs").exists() {
                    node_cmd.env("NODE_OPTIONS", "--require ./hide-console.cjs");
                }
                match spawn_hidden(&mut node_cmd)
                {
                    Ok(child) => {
                        println!("[LumiOS] Backend PID: {}", child.id());
                        let app_state = app.state::<Mutex<BackendProcesses>>();
                        let mut state = app_state.lock().unwrap();
                        state.node_config = Some(SpawnConfig {
                            exe: normalized_node.to_path_buf(),
                            entry: normalized_entry.to_path_buf(),
                            work_dir: normalized_cwd.to_path_buf(),
                        });
                        state.node = Some(child);
                    }
                    Err(e) => {
                        eprintln!("[LumiOS] Failed to start backend: {}", e);
                    }
                }
            } else {
                eprintln!(
                    "[LumiOS] Backend not found. node.exe: {}, entry.cjs: {}, server.mjs: {}",
                    node_bin.exists(),
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
                let app_state = app.state::<Mutex<BackendProcesses>>();
                let mut state = app_state.lock().unwrap();
                if python_exe.exists() && api_py.exists() {
                    state.python_config = Some(SpawnConfig {
                        exe: python_exe,
                        entry: api_py,
                        work_dir: gpt_sovits_dir,
                    });
                } else {
                    state.python_config = Some(SpawnConfig {
                        exe: dev_python,
                        entry: dev_api,
                        work_dir: PathBuf::from("../gpt-sovits-src"),
                    });
                }
                state.python = Some(child);
            }
            } // end else (release mode spawns backend)

            // ── Child process health check (release mode, checks every 30s) ──
            if !cfg!(debug_assertions) {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    let max_restarts: u32 = 3;
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        let app_state = app_handle.state::<Mutex<BackendProcesses>>();
                        let mut state = app_state.lock().unwrap();

                        // Check Node.js backend
                        let mut restart_node = false;
                        if let Some(ref mut child) = state.node {
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    eprintln!("[LumiOS] Node backend exited with status {:?}", status.code());
                                    restart_node = true;
                                }
                                Ok(None) => { /* still running */ }
                                Err(e) => {
                                    eprintln!("[LumiOS] Node backend health check failed: {}", e);
                                    restart_node = true;
                                }
                            }
                        }
                        if restart_node && state.node_restarts < max_restarts {
                            if let Some(ref cfg) = state.node_config {
                                eprintln!("[LumiOS] Restarting Node backend (attempt {}/{})", state.node_restarts + 1, max_restarts);
                                let mut restart_cmd = Command::new(&cfg.exe);
                                restart_cmd.arg(&cfg.entry)
                                    .env("LUMI_DESKTOP", "1")
                                    .env("HOST", "127.0.0.1")
                                    .current_dir(&cfg.work_dir);
                                #[cfg(target_os = "windows")]
                                if cfg.work_dir.join("hide-console.cjs").exists() {
                                    restart_cmd.env("NODE_OPTIONS", "--require ./hide-console.cjs");
                                }
                                match spawn_hidden(&mut restart_cmd)
                                {
                                    Ok(child) => {
                                        println!("[LumiOS] Backend restarted, PID: {}", child.id());
                                        state.node = Some(child);
                                        state.node_restarts += 1;
                                    }
                                    Err(e) => {
                                        eprintln!("[LumiOS] Failed to restart Node backend: {}", e);
                                    }
                                }
                            }
                        } else if restart_node {
                            eprintln!("[LumiOS] Node backend max restarts ({}) reached, giving up", max_restarts);
                            state.node = None;
                        }

                        // Check GPT-SoVITS Python API
                        let mut restart_python = false;
                        if let Some(ref mut child) = state.python {
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    eprintln!("[LumiOS] Python API exited with status {:?}", status.code());
                                    restart_python = true;
                                }
                                Ok(None) => { /* still running */ }
                                Err(e) => {
                                    eprintln!("[LumiOS] Python API health check failed: {}", e);
                                    restart_python = true;
                                }
                            }
                        }
                        if restart_python && state.python_restarts < max_restarts {
                            if let Some(ref cfg) = state.python_config {
                                eprintln!("[LumiOS] Restarting Python API (attempt {}/{})", state.python_restarts + 1, max_restarts);
                                let mut restart_py_cmd = Command::new(&cfg.exe);
                                restart_py_cmd.arg(&cfg.entry)
                                    .arg("-a").arg("127.0.0.1")
                                    .arg("-p").arg("9880")
                                    .arg("-c").arg("GPT_SoVITS/configs/tts_infer.yaml")
                                    .current_dir(&cfg.work_dir);
                                match spawn_hidden(&mut restart_py_cmd)
                                {
                                    Ok(child) => {
                                        println!("[LumiOS] Python API restarted, PID: {}", child.id());
                                        state.python = Some(child);
                                        state.python_restarts += 1;
                                    }
                                    Err(e) => {
                                        eprintln!("[LumiOS] Failed to restart Python API: {}", e);
                                    }
                                }
                            }
                        } else if restart_python {
                            eprintln!("[LumiOS] Python API max restarts ({}) reached, giving up", max_restarts);
                            state.python = None;
                        }
                    }
                });
            }

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
