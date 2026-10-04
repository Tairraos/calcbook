use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const CALCULATOR_LABEL: &str = "calculator";
pub const NARROW_WIDTH: f64 = 300.0;
pub const WINDOW_HEIGHT: f64 = 500.0;
pub const VISIBILITY_EVENT: &str = "calculator://visible";

/// 计算器窗口状态：窗口按需创建，「关闭」实际是隐藏，webview 常驻以保留算式与历史。
pub struct CalculatorLock(pub Mutex<()>);

fn ensure_calculator<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(CALCULATOR_LABEL) {
        return Ok(window);
    }
    let builder = WebviewWindowBuilder::new(
        app,
        CALCULATOR_LABEL,
        WebviewUrl::App("index.html?view=calculator".into()),
    )
    .title("计算器 · calcbook")
    .inner_size(NARROW_WIDTH, WINDOW_HEIGHT)
    .minimizable(true)
    // 不允许最大化：macOS 上同时禁掉绿点的 zoom 与双击标题栏放大。
    .maximizable(false)
    // 宽高固定：窄态 300×500，展开最近计算后由前端切到 600×500，用户不能手动 resize。
    .resizable(false)
    // tauri 默认建窗即显示：若不显式隐藏，toggle 里 is_visible() 为 true 会把
    // 刚建好的窗口立即收起——表现为「启动后要点两下才出计算器」。先隐藏，
    // 由 toggle 统一走居中 + show 的路径。
    .visible(false);
    // 与主窗一致：保留红绿灯、隐藏标题文字，内容延伸到标题栏下方。
    // title_bar_style / hidden_title 是 macOS 专属 API（Windows 需 unstable feature，
    // Linux 不支持），其他平台用系统默认标题栏。
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder
        .build()
        .map_err(|error| format!("无法打开计算器窗口：{error}"))?;
    center_on_main(app, &window)?;
    Ok(window)
}

/// 非 macOS 平台的居中换算：把主窗与计算器的物理几何按各自显示器的缩放比换算成
/// 逻辑坐标再求中心（tao 在这些平台的 set_position 可跨屏，无 macOS 的屏幕约束问题）。
/// 返回值即 tao `set_position(LogicalPosition)` 的入参。
#[cfg(not(target_os = "macos"))]
fn centered_points(
    main_pos: (i32, i32),
    main_size: (u32, u32),
    main_scale: f64,
    self_size: (u32, u32),
    self_scale: f64,
) -> (f64, f64) {
    // mock 运行时的 scale_factor 可能是 0，按 1 处理避免除零。
    let main_scale = if main_scale > 0.0 { main_scale } else { 1.0 };
    let self_scale = if self_scale > 0.0 { self_scale } else { 1.0 };
    let main_x = f64::from(main_pos.0) / main_scale;
    let main_y = f64::from(main_pos.1) / main_scale;
    let main_w = f64::from(main_size.0) / main_scale;
    let main_h = f64::from(main_size.1) / main_scale;
    let self_w = f64::from(self_size.0) / self_scale;
    let self_h = f64::from(self_size.1) / self_scale;
    let x = main_x + (main_w - self_w) / 2.0;
    let y = (main_y + (main_h - self_h) / 2.0).max(0.0);
    (x, y)
}

/// 用两个窗口的 frame（左下原点、单位点）求计算器的左下角原点，使中心对齐主窗中心。
/// 计算器窗口恒小于主窗，居中结果必落在主窗所在屏幕内，无需越界钳制。
fn centered_origin(main_frame: (f64, f64, f64, f64), self_size: (f64, f64)) -> (f64, f64) {
    let (main_x, main_y, main_w, main_h) = main_frame;
    let (self_w, self_h) = self_size;
    let x = main_x + (main_w - self_w) / 2.0;
    // 计算器顶边 = 主窗顶边（y + h）下移（主窗高 - 计算器高）/ 2。
    let top = main_y + main_h - (main_h - self_h) / 2.0;
    (x, top - self_h)
}

/// 把计算器窗口的中心对准主窗口中心；主窗不存在（测试或异常）时不动。
fn center_on_main<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Result<(), String> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        center_on_main_macos(&main, window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        center_on_main_portable(&main, window)
    }
}

/// macOS：tao 的 set_position 底层是 NSWindow.setFrameTopLeftPoint，AppKit 会把窗口
/// 约束在当前屏幕内——主窗在另一块屏幕时定位被静默忽略（0.6.5 实测：计算器停在
/// 新窗口的默认级联位置）。setFrame(_:display:) 是唯一能跨屏移动的定位方式；
/// 且 NSWindow.frame 给出的是真实点坐标，不再经 tao 的物理像素与缩放比换算。
#[cfg(target_os = "macos")]
fn center_on_main_macos<R: Runtime>(
    main: &WebviewWindow<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let main_window = main
        .ns_window()
        .map_err(|error| format!("无法定位主窗：{error}"))?;
    let self_window = window
        .ns_window()
        .map_err(|error| format!("无法定位计算器：{error}"))?;
    // 任一窗口读不到 frame（窗口刚销毁等竞态）就跳过本次定位，不影响打开。
    let Some(main_frame) = macos_window::frame(main_window) else {
        return Ok(());
    };
    let Some(self_frame) = macos_window::frame(self_window) else {
        return Ok(());
    };
    let (x, y) = centered_origin(main_frame, (self_frame.2, self_frame.3));
    macos_window::set_frame(self_window, x, y, self_frame.2, self_frame.3);
    Ok(())
}

/// 非 macOS 平台：tao 的 set_position 可跨屏，沿用按各自缩放比换算的逻辑坐标。
#[cfg(not(target_os = "macos"))]
fn center_on_main_portable<R: Runtime>(
    main: &WebviewWindow<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    if let (Ok(position), Ok(size), Ok(scale)) = (
        main.outer_position(),
        main.outer_size(),
        main.scale_factor(),
    ) {
        if let (Ok(self_size), Ok(self_scale)) = (window.outer_size(), window.scale_factor()) {
            let (x, y) = centered_points(
                (position.x, position.y),
                (size.width, size.height),
                scale,
                (self_size.width, self_size.height),
                self_scale,
            );
            window
                .set_position(tauri::LogicalPosition::new(x, y))
                .map_err(|error| format!("无法定位计算器窗口：{error}"))?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_window {
    use objc2_app_kit::NSWindow;

    /// 读 NSWindow.frame：macOS 全局坐标、左下原点、单位是点，返回 (x, y, w, h)。
    pub fn frame(ns_window: *mut std::ffi::c_void) -> Option<(f64, f64, f64, f64)> {
        let window = unsafe { (ns_window as *mut NSWindow).as_ref()? };
        let frame = window.frame();
        Some((
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        ))
    }

    /// setFrame:display: —— 跨屏移动窗口；tao 的 setFrameTopLeftPoint 做不到这一点。
    pub fn set_frame(ns_window: *mut std::ffi::c_void, x: f64, y: f64, w: f64, h: f64) {
        let Some(window) = (unsafe { (ns_window as *mut NSWindow).as_ref() }) else {
            return;
        };
        window.setFrame_display(
            objc2_foundation::NSRect::new(
                objc2_foundation::NSPoint::new(x, y),
                objc2_foundation::NSSize::new(w, h),
            ),
            true,
        );
    }
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
        // 最小化中：还原后重新居中到主窗（主窗可能已移到另一块屏幕），再聚焦。
        window
            .unminimize()
            .map_err(|error| format!("无法还原计算器：{error}"))?;
        center_on_main(app, &window)?;
        window
            .set_focus()
            .map_err(|error| format!("无法聚焦计算器：{error}"))?;
        emit_visibility(app, true)?;
    } else if !window.is_visible().unwrap_or(false) {
        // 未打开（含被关闭后再次打开）：重新居中到主窗，再显示并聚焦。
        center_on_main(app, &window)?;
        window
            .show()
            .map_err(|error| format!("无法打开计算器：{error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("无法聚焦计算器：{error}"))?;
        emit_visibility(app, true)?;
    } else {
        // 已开着：点击高亮按钮即收起。
        hide(&window, app)?;
    }
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
        // 主窗关闭时兜底记录尺寸（前端另有防抖保存；Cmd+Q 等路径靠这里）
        tauri::WindowEvent::CloseRequested { .. } if window.label() == "main" => {
            if let (Ok(physical), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                let _ = crate::store(&window.app_handle().clone()).and_then(|store| {
                    store.save_window_size(crate::storage::WindowSize {
                        width: physical.width as f64 / scale,
                        height: physical.height as f64 / scale,
                    })
                });
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

    #[cfg(test)]
    #[cfg(not(target_os = "macos"))]
    mod portable_geometry_tests {
        use super::centered_points;

        #[test]
        fn centered_points_matches_same_scale_geometry() {
            // 回归锚点：主窗 2x 位于物理 (232,160)、2560x1642，计算器 2x 600x1000，
            // 0.6.4 实测打开在点坐标 (606,241)，公式必须复现同一结果。
            let (x, y) = centered_points((232, 160), (2560, 1642), 2.0, (600, 1000), 2.0);
            assert_eq!((x, y), (606.0, 240.5));
        }

        #[test]
        fn centered_points_survives_mixed_scale_screens() {
            // 主窗移到 1x 外接屏（物理=点），计算器还留在 2x 内置屏（物理=点x2）：
            // 计算器必须以自己的点尺寸 300x500 参与居中，而不是 600x1000。
            let (x, y) = centered_points((1600, 100), (1280, 820), 1.0, (600, 1000), 2.0);
            assert_eq!((x, y), (2090.0, 260.0));
            // 反向：主窗在 2x 内置屏，计算器留在 1x 外接屏，同一居中结果。
            let (x, y) = centered_points((3200, 200), (2560, 1640), 2.0, (300, 500), 1.0);
            assert_eq!((x, y), (2090.0, 260.0));
        }

        #[test]
        fn centered_points_never_returns_negative_y() {
            let (x, y) = centered_points((0, 0), (1280, 300), 1.0, (300, 500), 1.0);
            assert_eq!((x, y), (490.0, 0.0));
        }

        #[test]
        fn centered_points_treats_zero_scale_as_one() {
            // mock 运行时 scale_factor 可能为 0：退化为物理坐标直算，不 panic、不产生 NaN。
            let (x, y) = centered_points((116, 80), (1280, 820), 0.0, (300, 500), 0.0);
            assert_eq!((x, y), (606.0, 240.0));
        }
    }

    #[test]
    fn centered_origin_matches_same_screen_anchor() {
        // 回归锚点：主窗 AX 位置 [116, 80, 1280, 821]（bl 原点 y = 982-80-821 = 81），
        // 计算器 300x500 居中后 AX 位置 [606, 240.5]，与 0.6.4/0.6.5 实测 [606,241] 一致。
        let (x, y) = centered_origin((116.0, 81.0, 1280.0, 821.0), (300.0, 500.0));
        assert_eq!((x, y), (606.0, 241.5));
    }

    #[test]
    fn centered_origin_follows_main_to_other_screen() {
        // 0.6.5 实机故障现场：主窗移到外接屏 AX [-447, -1185]（bl y = 1346，屏高 1440），
        // 计算器必须落在同一块屏（bl y 区间 1346..2786）而不是留在内置屏。
        let (x, y) = centered_origin((-447.0, 1346.0, 1280.0, 821.0), (300.0, 500.0));
        assert_eq!((x, y), (43.0, 1506.5));
        assert!(
            (1506.5..=2006.5).contains(&y),
            "计算器整体须落在主窗所在屏幕的纵向区间内"
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
