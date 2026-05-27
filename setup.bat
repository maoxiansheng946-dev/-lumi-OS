@echo off
chcp 65001 >nul
title LumiOS Setup

echo.
echo   LumiOS — 安装环境 & 启动
echo   -------------------------
echo.

:: 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [1/3] 安装 Node.js...
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    echo 请关闭此窗口、重新打开后再次运行 setup.bat
    pause
    exit
)
echo [1/3] Node.js 已安装:
node -v

:: 检查 pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [2/3] 安装 pnpm...
    npm i -g pnpm
)
echo [2/3] pnpm 已安装:
pnpm -v

:: 安装依赖
echo [3/3] 安装项目依赖...
pnpm install --ignore-scripts

:: 创建 .env
if not exist .env (
    copy .env.example .env
    echo 已创建 .env，请编辑填入 API Key 后重新运行此脚本
    start notepad .env
    pause
    exit
)

:: 启动
echo.
echo 环境就绪，启动中...
echo 桌面客户端: http://localhost:5174
echo.
pnpm dev:desktop
