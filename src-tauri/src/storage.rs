use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 24_000_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    id: String,
    title: String,
    body: String,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    version: u8,
    notes: Vec<Note>,
    active_id: Option<String>,
    theme: String,
    #[serde(default = "default_calculator_mode")]
    calculator_mode: String,
}

fn default_calculator_mode() -> String {
    "sidebar".into()
}

impl Workspace {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.notes.len() > 100 {
            return Err("笔记版本不受支持或笔记数量超过 100 篇".into());
        }
        if !matches!(
            self.theme.as_str(),
            "light" | "dark" | "paper" | "sand" | "mist" | "forest" | "midnight" | "graphite"
        ) {
            return Err("主题配置无效".into());
        }
        if !matches!(self.calculator_mode.as_str(), "sidebar" | "dialog") {
            return Err("计算器显示配置无效".into());
        }
        let mut ids = HashSet::new();
        for note in &self.notes {
            if note.id.is_empty()
                || note.id.len() > 100
                || !ids.insert(note.id.as_str())
                || note.title.encode_utf16().count() > 120
                || note.body.encode_utf16().count() > 100_000
                || note.created_at.is_empty()
                || note.updated_at.is_empty()
                || note.created_at.len() > 40
                || note.updated_at.len() > 40
            {
                return Err("笔记内容无效或超过长度限制".into());
            }
        }
        if self
            .active_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id.as_str()))
        {
            return Err("当前笔记引用无效".into());
        }
        Ok(())
    }
}

pub fn load(directory: &Path) -> Result<Option<Workspace>, String> {
    let path = directory.join("workspace.json");
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取笔记：{error}")),
    };
    if metadata.len() > MAX_FILE_BYTES {
        return Err("笔记文件超过 24 MB，原文件已保留".into());
    }
    let data = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
    let workspace: Workspace = serde_json::from_slice(&data)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    workspace.validate()?;
    Ok(Some(workspace))
}

pub fn save(directory: &Path, workspace: &Workspace) -> Result<(), String> {
    workspace.validate()?;
    let bytes = serde_json::to_vec(workspace).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("笔记文件超过 24 MB，未覆盖原文件".into());
    }
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    let path = directory.join("workspace.json");
    let temporary = directory.join("workspace.json.tmp");
    let mut file =
        fs::File::create(&temporary).map_err(|error| format!("无法暂存笔记：{error}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("保存笔记失败：{error}"))?;
    drop(file);
    if path.exists() {
        // Never overwrite an unreadable/unknown-version workspace, even on a later save.
        load(directory)?;
        fs::copy(&path, directory.join("workspace.json.bak"))
            .map_err(|error| format!("备份笔记失败：{error}"))?;
    }
    fs::rename(&temporary, &path).map_err(|error| format!("替换笔记文件失败：{error}"))?;
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("笔记已写入，但磁盘同步失败：{error}"))?;
    Ok(())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    data_directory: Option<PathBuf>,
}

pub struct Store {
    pub config: PathBuf,
    pub default: PathBuf,
    pub legacy: Option<PathBuf>,
}

impl Store {
    fn settings(&self) -> Result<Settings, String> {
        let path = self.config.join("settings.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Settings::default())
            }
            Err(error) => return Err(format!("无法读取存储配置：{error}")),
        };
        let settings: Settings = serde_json::from_slice(&bytes)
            .map_err(|error| format!("存储配置损坏，原文件已保留：{error}"))?;
        if settings
            .data_directory
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
        {
            return Err("存储目录必须是绝对路径，原配置已保留".into());
        }
        Ok(settings)
    }

    pub fn directory(&self) -> Result<PathBuf, String> {
        Ok(self
            .settings()?
            .data_directory
            .unwrap_or_else(|| self.default.clone()))
    }

    pub fn load(&self) -> Result<Option<Workspace>, String> {
        let settings = self.settings()?;
        let directory = settings.data_directory.as_ref().unwrap_or(&self.default);
        if let Some(workspace) = load(directory)? {
            return Ok(Some(workspace));
        }
        if settings.data_directory.is_some() {
            return Err("指定目录中的 workspace.json 不存在，请检查磁盘或恢复文件后重试".into());
        }
        if let Some(legacy) = self.legacy.as_ref().filter(|path| *path != directory) {
            if let Some(workspace) = load(legacy)? {
                save(directory, &workspace)?;
                return Ok(Some(workspace));
            }
        }
        Ok(None)
    }

    pub fn relocate(&self, target: &Path) -> Result<(), String> {
        // The target comes only from the native folder picker, never from webview input.
        let target =
            fs::canonicalize(target).map_err(|error| format!("无法打开所选目录：{error}"))?;
        if !target.is_dir() {
            return Err("请选择一个文件夹".into());
        }
        let current = self.directory()?;
        if fs::canonicalize(&current).ok().as_ref() == Some(&target) {
            return Ok(());
        }
        let workspace = load(&current)?.ok_or("请先保存笔记，再修改存储位置")?;
        if let Some(existing) = load(&target)? {
            if existing != workspace {
                return Err("所选目录已包含另一份笔记，未覆盖。请选择空文件夹".into());
            }
        } else {
            save(&target, &workspace)?;
        }
        // Commit the location only after the complete workspace is safely written.
        fs::create_dir_all(&self.config).map_err(|error| format!("无法创建配置目录：{error}"))?;
        let bytes = serde_json::to_vec(&Settings {
            data_directory: Some(target),
        })
        .map_err(|error| error.to_string())?;
        let temporary = self.config.join("settings.json.tmp");
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法暂存配置：{error}"))?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("存储位置未改变：{error}"))?;
        drop(file);
        fs::rename(temporary, self.config.join("settings.json"))
            .map_err(|error| format!("存储位置未改变：{error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample() -> Workspace {
        Workspace {
            version: 1,
            notes: vec![Note {
                id: "note-1".into(),
                title: "预算".into(),
                body: "0.1 + 0.2".into(),
                created_at: "2026-09-06T00:00:00.000Z".into(),
                updated_at: "2026-09-06T00:00:00.000Z".into(),
                trashed: false,
            }],
            active_id: Some("note-1".into()),
            theme: "paper".into(),
            calculator_mode: "sidebar".into(),
        }
    }

    #[test]
    fn workspace_roundtrip_backup_and_failure_recovery() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("calcbook-test-{unique}"));
        assert!(load(&directory).unwrap().is_none());
        let mut workspace = sample();
        save(&directory, &workspace).unwrap();
        assert_eq!(
            load(&directory).unwrap().unwrap().notes[0].body,
            "0.1 + 0.2"
        );
        let original = fs::read(directory.join("workspace.json")).unwrap();
        workspace.notes[0].body = "changed".into();
        save(&directory, &workspace).unwrap();
        assert_eq!(
            fs::read(directory.join("workspace.json.bak")).unwrap(),
            original
        );
        let current = fs::read(directory.join("workspace.json")).unwrap();

        workspace.version = 2;
        assert!(save(&directory, &workspace).is_err());
        workspace.version = 1;
        workspace.notes.push(workspace.notes[0].clone());
        assert!(save(&directory, &workspace).is_err());
        workspace.notes.pop();
        assert_eq!(fs::read(directory.join("workspace.json")).unwrap(), current);

        fs::create_dir(directory.join("workspace.json.tmp")).unwrap();
        assert!(save(&directory, &workspace).is_err());
        assert_eq!(fs::read(directory.join("workspace.json")).unwrap(), current);
        fs::remove_dir(directory.join("workspace.json.tmp")).unwrap();

        fs::write(directory.join("workspace.json"), b"broken-json").unwrap();
        assert!(load(&directory).is_err());
        assert!(save(&directory, &workspace).is_err());
        assert_eq!(
            fs::read(directory.join("workspace.json")).unwrap(),
            b"broken-json"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migration_relocation_and_failed_config_commit_preserve_all_workspaces() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("calcbook-relocation-{unique}"));
        let store = Store {
            config: root.join("config"),
            default: root.join("default"),
            legacy: Some(root.join("legacy")),
        };
        let legacy = store.legacy.as_ref().unwrap();
        fs::create_dir_all(legacy).unwrap();
        let mut old = serde_json::to_value(sample()).unwrap();
        old.as_object_mut().unwrap().remove("calculatorMode");
        old["theme"] = "dark".into();
        let legacy_bytes = serde_json::to_vec(&old).unwrap();
        fs::write(legacy.join("workspace.json"), &legacy_bytes).unwrap();
        let mut workspace = store.load().unwrap().unwrap();
        assert_eq!(workspace.theme, "dark");
        assert_eq!(workspace.calculator_mode, "sidebar");
        assert_eq!(load(&store.default).unwrap().unwrap(), workspace);
        assert_eq!(
            fs::read(legacy.join("workspace.json")).unwrap(),
            legacy_bytes
        );

        workspace.theme = "midnight".into();
        workspace.calculator_mode = "dialog".into();
        save(&store.directory().unwrap(), &workspace).unwrap();
        let original = fs::read(store.default.join("workspace.json")).unwrap();
        let occupied = root.join("occupied");
        save(&occupied, &sample()).unwrap();
        let occupied_bytes = fs::read(occupied.join("workspace.json")).unwrap();
        assert!(store.relocate(&occupied).is_err());
        assert_eq!(store.directory().unwrap(), store.default);
        assert_eq!(
            fs::read(occupied.join("workspace.json")).unwrap(),
            occupied_bytes
        );

        let target = root.join("chosen folder 中文");
        fs::create_dir_all(&target).unwrap();
        // Force failure at the final settings commit after copying the workspace.
        fs::create_dir_all(store.config.join("settings.json.tmp")).unwrap();
        assert!(store.relocate(&target).is_err());
        assert_eq!(store.directory().unwrap(), store.default);
        assert_eq!(load(&target).unwrap().unwrap(), workspace);
        assert_eq!(
            fs::read(store.default.join("workspace.json")).unwrap(),
            original
        );
        fs::remove_dir(store.config.join("settings.json.tmp")).unwrap();

        store.relocate(&target).unwrap();
        assert_eq!(
            store.directory().unwrap(),
            fs::canonicalize(&target).unwrap()
        );
        workspace.notes[0].body = "只写入新目录".into();
        save(&store.directory().unwrap(), &workspace).unwrap();
        assert_eq!(store.load().unwrap().unwrap(), workspace);
        assert_eq!(
            fs::read(store.default.join("workspace.json")).unwrap(),
            original
        );
        assert_eq!(
            fs::read(legacy.join("workspace.json")).unwrap(),
            legacy_bytes
        );

        workspace.calculator_mode = "invalid".into();
        assert!(save(&target, &workspace).is_err());
        fs::remove_file(target.join("workspace.json")).unwrap();
        assert!(store.load().is_err());
        fs::write(store.config.join("settings.json"), b"broken-json").unwrap();
        assert!(store.directory().is_err());
        assert!(store.relocate(&occupied).is_err());
        assert_eq!(
            fs::read(store.config.join("settings.json")).unwrap(),
            b"broken-json"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
