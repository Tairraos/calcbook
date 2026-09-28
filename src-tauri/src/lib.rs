mod calculator;
mod storage;

use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct StoreLock(Mutex<()>);

fn store(app: &tauri::AppHandle) -> Result<storage::Store, String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let default = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".calcbook");
    let legacy = Some(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    );
    #[cfg(debug_assertions)]
    {
        let config_override = std::env::var_os("CALCBOOK_CONFIG_DIR");
        let data_override = std::env::var_os("CALCBOOK_DATA_DIR");
        if config_override.is_some() || data_override.is_some() {
            if config_override.is_none() || data_override.is_none() {
                return Err("开发隔离需要同时设置 CALCBOOK_CONFIG_DIR 和 CALCBOOK_DATA_DIR".into());
            }
            let store = storage::Store {
                config: PathBuf::from(config_override.unwrap()),
                default: PathBuf::from(data_override.unwrap()),
                legacy: None,
            };
            if !store.config.is_absolute() || !store.default.is_absolute() {
                return Err("开发存储目录需要使用绝对路径".into());
            }
            return Ok(store);
        }
    }
    Ok(storage::Store {
        config,
        default,
        legacy,
    })
}

#[tauri::command]
fn scan_workspace(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
) -> Result<Option<storage::Payload>, String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    store(&app)?.load()
}

#[tauri::command]
fn save_workspace_settings(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    theme: String,
    #[allow(non_snake_case)] activeId: Option<String>,
    format: storage::FormatSettings,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::save_settings(
        &store(&app)?.directory()?,
        &theme,
        activeId.as_deref(),
        &format,
    )
}

#[tauri::command]
fn create_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    title: String,
    body: String,
) -> Result<storage::PayloadNote, String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::create_note(&store(&app)?.directory()?, &title, &body)
}

#[tauri::command]
fn write_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    #[allow(non_snake_case)] noteId: String,
    body: String,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::write_note(&store(&app)?.directory()?, &noteId, &body)
}

#[tauri::command]
fn move_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    #[allow(non_snake_case)] noteId: String,
    #[allow(non_snake_case)] toRecycled: bool,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::move_note(&store(&app)?.directory()?, &noteId, toRecycled)
}

#[tauri::command]
fn delete_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    #[allow(non_snake_case)] noteId: String,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::delete_note(&store(&app)?.directory()?, &noteId)
}

#[tauri::command]
fn ensure_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    #[allow(non_snake_case)] noteId: String,
    title: String,
) -> Result<bool, String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::ensure_note(&store(&app)?.directory()?, &noteId, &title)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    directory: PathBuf,
    default_directory: PathBuf,
    can_choose: bool,
}

#[tauri::command]
fn storage_info(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
) -> Result<StorageInfo, String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    let store = store(&app)?;
    Ok(StorageInfo {
        directory: store.directory()?,
        default_directory: store.default,
        can_choose: true,
    })
}

#[tauri::command]
async fn choose_storage_directory(app: tauri::AppHandle) -> Result<Option<StorageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store(&app)?;
        let choice = app
            .dialog()
            .file()
            .set_title("选择笔记存储文件夹")
            .set_directory(store.directory()?)
            .blocking_pick_folder();
        let Some(choice) = choice else {
            return Ok(None);
        };
        let path = choice.into_path().map_err(|error| error.to_string())?;
        let lock = app.state::<StoreLock>();
        let guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
        store.relocate(&path)?;
        drop(guard);
        storage_info(app.clone(), app.state::<StoreLock>()).map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn toggle_calculator(app: tauri::AppHandle) -> Result<CalculatorStatus, String> {
    let (visible, minimized) = calculator::toggle(&app)?;
    Ok(CalculatorStatus { visible, minimized })
}

#[tauri::command]
fn hide_calculator(app: tauri::AppHandle) -> Result<(), String> {
    calculator::hide_calculator(&app)
}

#[tauri::command]
fn calculator_state(app: tauri::AppHandle) -> Result<CalculatorStatus, String> {
    let (visible, minimized) = calculator::state(&app)?;
    Ok(CalculatorStatus { visible, minimized })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CalculatorStatus {
    visible: bool,
    minimized: bool,
}

#[tauri::command]
fn reveal_note(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    note_id: String,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    let store = store(&app)?;
    let directory = store.directory()?;
    // noteId 来自扫描结果（id 即文件相对路径），Rust 侧再做路径安全校验。
    let path = storage::resolve_note_path(&directory, &note_id)?.0;
    if !path.exists() {
        return Err("笔记尚未保存到磁盘".into());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| format!("无法在访达中显示：{error}"))
}

#[tauri::command]
fn open_project(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/Tairraos/calcbook", None::<&str>)
        .map_err(|error| format!("无法打开项目链接：{error}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedNote {
    title: String,
    content: String,
}

/// 打开一个 Numi 兼容的 .txt 笔记并返回原始文本；`= 结果` 由前端剥离后重新计算。
#[tauri::command]
async fn import_note(app: tauri::AppHandle) -> Result<Option<ImportedNote>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(choice) = app
            .dialog()
            .file()
            .add_filter("文本笔记", &["txt"])
            .set_title("导入 Numi 文本笔记")
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = choice.into_path().map_err(|error| error.to_string())?;
        let metadata =
            std::fs::metadata(&path).map_err(|error| format!("无法读取所选文件：{error}"))?;
        if metadata.len() > 24_000_000 {
            return Err("所选文件超过 24 MB".into());
        }
        let bytes = std::fs::read(&path).map_err(|error| format!("无法读取所选文件：{error}"))?;
        let content =
            String::from_utf8(bytes).map_err(|_| "所选文件不是 UTF-8 文本".to_string())?;
        if content.encode_utf16().count() > 100_000 {
            return Err("笔记超过 100,000 字上限".into());
        }
        let title = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().trim().to_string())
            .filter(|stem| !stem.is_empty())
            .unwrap_or_else(|| "导入的笔记".into());
        Ok(Some(ImportedNote { title, content }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StoreLock(Mutex::new(())))
        .manage(calculator::CalculatorLock(Mutex::new(())))
        .on_window_event(calculator::on_window_event)
        .invoke_handler(tauri::generate_handler![
            scan_workspace,
            save_workspace_settings,
            export_note,
            import_note,
            toggle_calculator,
            hide_calculator,
            calculator_state,
            create_note,
            write_note,
            move_note,
            delete_note,
            ensure_note,
            reveal_note,
            storage_info,
            choose_storage_directory,
            open_project
        ])
        .run(tauri::generate_context!())
        .expect("Calcbook 无法启动");
}

#[tauri::command]
async fn export_note(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    if filename.len() > 500 || content.encode_utf16().count() > 100_000 {
        return Err("笔记超过导出长度限制".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let choice = app
            .dialog()
            .file()
            .add_filter("文本笔记", &["txt"])
            .set_file_name(filename)
            .blocking_save_file();
        let Some(choice) = choice else {
            return Ok(false);
        };
        let path = choice.into_path().map_err(|error| error.to_string())?;
        std::fs::write(path, content).map_err(|error| format!("导出失败：{error}"))?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}
