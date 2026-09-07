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
fn load_workspace(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
) -> Result<Option<storage::Workspace>, String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    store(&app)?.load()
}

#[tauri::command]
fn save_workspace(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    workspace: storage::Workspace,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "笔记存储忙，请重启应用")?;
    storage::save(&store(&app)?.directory()?, &workspace)
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
fn open_project(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/Tairraos/calcbook", None::<&str>)
        .map_err(|error| format!("无法打开项目链接：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StoreLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            export_note,
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
