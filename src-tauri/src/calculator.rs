use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const CALCULATOR_LABEL: &str = "calculator";
pub const NARROW_WIDTH: f64 = 300.0;
pub const WINDOW_HEIGHT: f64 = 540.0;
pub const VISIBILITY_EVENT: &str = "calculator://visible";

/// 计算器窗口状态：窗口按需创建，「关闭」实际是隐藏，webview 常驻以保留算式与历史。
pub struct CalculatorLock(pub Mutex<()>);

fn ensure_calculator<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(CALCULATOR_LABEL) {
        return Ok(window);
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        CALCULATOR_LABEL,
        WebviewUrl::App("index.html?view=calculator".into()),
    )
    .title("计算器 · calcbook")
    .inner_size(NARROW_WIDTH, WINDOW_HEIGHT)
    // 与主窗一致：保留红绿灯、隐藏标题文字，内容延伸到标题栏下方。
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .minimizable(true)
    // 不允许最大化：macOS 上同时禁掉绿点的 zoom 与双击标题栏放大。
    .maximizable(false)
    // 宽高固定：窄态 300×540，展开最近计算后由前端切到 500×540，用户不能手动 resize。
    .resizable(false);
    // 默认出现在主窗口正中间；主窗不存在（测试或异常）时用系统默认位置。
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(position), Ok(size), Ok(scale)) = (
            main.outer_position(),
            main.outer_size(),
            main.scale_factor(),
        ) {
            // 窗口尺寸是逻辑单位，先按主窗缩放比换算成物理像素再求中心。
            let width = (NARROW_WIDTH * scale) as i32;
            let height = (WINDOW_HEIGHT * scale) as i32;
            let x = position.x + (size.width as i32 - width) / 2;
            let y = (position.y + (size.height as i32 - height) / 2).max(0);
            builder = builder.position(x as f64 / scale, y as f64 / scale);
        }
    }
    builder
        .build()
        .map_err(|error| format!("无法打开计算器窗口：{error}"))
}

pub fn status<R: Runtime>(window: Option<&WebviewWindow<R>>) -> (bool, bool) {
    match window {
        None => (false, false),
        Some(window) => (
            window.is_visible().unwrap_or(false),
            window.is_minimized().unwrap_or(false),
        ),
    }
}

pub fn emit_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    app.emit(VISIBILITY_EVENT, visible)
        .map_err(|error| error.to_string())
}

fn hide<R: Runtime>(window: &WebviewWindow<R>, app: &AppHandle<R>) -> Result<(), String> {
    window
        .hide()
        .map_err(|error| format!("无法收起计算器：{error}"))?;
    emit_visibility(app, false)
}

/// 主窗口「计算器」按钮：打开、聚焦；最小化时还原。窗口只有一个实例。
pub fn toggle<R: Runtime>(app: &AppHandle<R>) -> Result<(bool, bool), String> {
    let state = app.state::<CalculatorLock>();
    let _guard = state.0.lock().map_err(|_| "计算器忙，请重试")?;
    let window = ensure_calculator(app)?;
    if window.is_minimized().unwrap_or(false) {
        window
            .unminimize()
            .map_err(|error| format!("无法还原计算器：{error}"))?;
    } else if !window.is_visible().unwrap_or(false) {
        window
            .show()
            .map_err(|error| format!("无法打开计算器：{error}"))?;
    }
    window
        .set_focus()
        .map_err(|error| format!("无法聚焦计算器：{error}"))?;
    emit_visibility(app, true)?;
    Ok(status(Some(&window)))
}

/// 前端失焦 5 分钟自动收起，或显式隐藏。
pub fn hide_calculator<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<CalculatorLock>();
    let _guard = state.0.lock().map_err(|_| "计算器忙，请重试")?;
    if let Some(window) = app.get_webview_window(CALCULATOR_LABEL) {
        if window.is_visible().unwrap_or(false) {
            hide(&window, app)?;
        }
    }
    Ok(())
}

pub fn state<R: Runtime>(app: &AppHandle<R>) -> Result<(bool, bool), String> {
    Ok(status(app.get_webview_window(CALCULATOR_LABEL).as_ref()))
}

/// 全局窗口钩子：计算器的红绿灯「关闭」转为隐藏（保留状态）；主窗销毁时连带销毁计算器。
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } if window.label() == CALCULATOR_LABEL => {
            api.prevent_close();
            let app = window.app_handle().clone();
            if let Some(webview) = app.get_webview_window(CALCULATOR_LABEL) {
                let _ = hide(&webview, &app);
            }
        }
        tauri::WindowEvent::Destroyed if window.label() == "main" => {
            if let Some(webview) = window.app_handle().get_webview_window(CALCULATOR_LABEL) {
                let _ = webview.destroy();
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_defaults_to_hidden_without_window() {
        assert_eq!(
            status(None::<&WebviewWindow<tauri::test::MockRuntime>>),
            (false, false)
        );
    }

    #[test]
    fn toggle_creates_one_window_and_hide_keeps_it_recoverable() {
        let app = tauri::test::mock_app();
        app.manage(CalculatorLock(Mutex::new(())));
        let handle = app.handle().clone();
        let (visible, minimized) = toggle(&handle).unwrap();
        assert!(visible && !minimized);
        // 同一实例：再 toggle 不新建窗口。
        toggle(&handle).unwrap();
        assert!(handle.get_webview_window(CALCULATOR_LABEL).is_some());
        assert_eq!(
            handle.webview_windows().len(),
            1,
            "mock 环境无主窗，只有一个计算器窗口"
        );
        // 「关闭」是隐藏不是销毁：mock 运行时不模拟可见性状态，这里验证窗口对象常驻。
        hide_calculator(&handle).unwrap();
        assert!(
            handle.get_webview_window(CALCULATOR_LABEL).is_some(),
            "隐藏后窗口对象仍存在，算式与历史得以保留"
        );
        // 再次打开仍是同一窗口。
        toggle(&handle).unwrap();
        assert_eq!(handle.webview_windows().len(), 1);
    }
}
