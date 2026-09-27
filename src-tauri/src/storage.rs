use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 24_000_000;
const MAX_FILENAME_BYTES: usize = 160;
const WORKSPACE_FILE: &str = "workspace.json";

/// 每篇笔记的正文是数据目录下一个 Numi 兼容的 .txt 文件；workspace.json 只保存元数据与文件名映射。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayloadNote {
    id: String,
    title: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    body: String,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    version: u8,
    notes: Vec<PayloadNote>,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
}

/// 落盘的元数据：正文在 .txt 文件里，这里不重复保存。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MetaNote {
    id: String,
    title: String,
    filename: String,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Meta {
    version: u8,
    notes: Vec<MetaNote>,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
}

/// 读取时兼容改造前的单文件格式：正文内联在 workspace.json 里，且没有 filename。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNote {
    id: String,
    title: String,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    body: Option<String>,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u8,
    notes: Vec<StoredNote>,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: Option<FormatSettings>,
}

fn valid_theme(theme: &str) -> bool {
    matches!(
        theme,
        "light" | "dark" | "paper" | "sand" | "mist" | "forest" | "midnight" | "graphite"
    )
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatSettings {
    #[serde(default)]
    thousands: bool,
    #[serde(default)]
    unit_space: bool,
    #[serde(default)]
    percent_space: bool,
    #[serde(default = "default_true")]
    operator_space: bool,
    #[serde(default = "default_true")]
    comment_space: bool,
    #[serde(default)]
    unit_style: String,
    #[serde(default)]
    unit_system: String,
}

impl Default for FormatSettings {
    fn default() -> Self {
        FormatSettings {
            thousands: false,
            unit_space: false,
            percent_space: false,
            operator_space: true,
            comment_space: true,
            unit_style: "free".into(),
            unit_system: "free".into(),
        }
    }
}

fn default_true() -> bool {
    true
}

impl FormatSettings {
    fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.unit_style.as_str(),
            "free" | "chinese" | "upper" | "lower"
        ) {
            return Err("单位风格配置无效".into());
        }
        if !matches!(
            self.unit_system.as_str(),
            "free" | "metric" | "imperial" | "market"
        ) {
            return Err("单位制配置无效".into());
        }
        Ok(())
    }
}

fn truncate_bytes(text: &str, limit: usize) -> String {
    let mut result = String::new();
    for character in text.chars() {
        if result.len() + character.len_utf8() > limit {
            break;
        }
        result.push(character);
    }
    result
}

/// 用标题生成文件名；标题里不能进文件名的字符换成 `-`，为空时退回笔记 id。
pub fn slugify(title: &str, id: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches(['.', ' ']).to_string();
    let stem = if trimmed.is_empty() {
        truncate_bytes(id, 60)
    } else {
        truncate_bytes(&trimmed, MAX_FILENAME_BYTES - 4)
    };
    format!("{stem}.txt")
}

fn unique_name(name: String, used: &HashSet<String>) -> String {
    if !used.contains(&name) {
        return name;
    }
    let stem = name.strip_suffix(".txt").unwrap_or(&name);
    let stem = truncate_bytes(stem, MAX_FILENAME_BYTES - 8);
    for index in 2..1000 {
        let candidate = format!("{stem} {index}.txt");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!("{}-{}.txt", stem, used.len())
}

/// 文件名只能是不含路径的普通名称，防止元数据把读写带出数据目录。
fn validate_filename(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if name.is_empty()
        || name.len() > MAX_FILENAME_BYTES
        || name.starts_with('.')
        || !name.ends_with(".txt")
        || path.components().count() != 1
        || path.file_name().is_none_or(|file| file != name)
    {
        return Err("笔记文件名无效，原文件已保留".into());
    }
    Ok(())
}

fn read_body(directory: &Path, filename: &str) -> Result<String, String> {
    let path = directory.join(filename);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("无法读取笔记 {filename}：{error}。原数据未改动"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!("笔记 {filename} 超过 24 MB，原文件已保留"));
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("无法读取笔记 {filename}：{error}。原数据未改动"))?;
    String::from_utf8(bytes).map_err(|_| format!("笔记 {filename} 不是 UTF-8 文本，原文件已保留"))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temporary = path.as_os_str().to_os_string();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let mut file =
        fs::File::create(&temporary).map_err(|error| format!("无法暂存文件：{error}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("写入失败：{error}"))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|error| format!("替换文件失败：{error}"))
}

impl Payload {
    /// 按 id 查找笔记的落盘文件名（元数据里的文件名已过 slugify 与落盘校验）。
    pub fn filename_of(&self, note_id: &str) -> Option<&str> {
        self.notes
            .iter()
            .find(|note| note.id == note_id)
            .map(|note| note.filename.as_str())
            .filter(|name| !name.is_empty())
    }
}

fn meta_from(payload: &Payload) -> Meta {
    Meta {
        version: payload.version,
        notes: payload
            .notes
            .iter()
            .map(|note| MetaNote {
                id: note.id.clone(),
                title: note.title.clone(),
                filename: note.filename.clone(),
                created_at: note.created_at.clone(),
                updated_at: note.updated_at.clone(),
                trashed: note.trashed,
            })
            .collect(),
        active_id: payload.active_id.clone(),
        theme: payload.theme.clone(),
        format: payload.format.clone(),
    }
}

fn read_stored(directory: &Path) -> Result<Option<Stored>, String> {
    let path = directory.join(WORKSPACE_FILE);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取笔记：{error}")),
    };
    if metadata.len() > MAX_FILE_BYTES {
        return Err("笔记文件超过 24 MB，原文件已保留".into());
    }
    let data = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
    let stored: Stored = serde_json::from_slice(&data)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    Ok(Some(stored))
}

fn validate_stored(stored: &Stored) -> Result<(), String> {
    if stored.version != 1 || stored.notes.len() > 100 {
        return Err("笔记版本不受支持或笔记数量超过 100 篇".into());
    }
    if !valid_theme(&stored.theme) {
        return Err("主题配置无效".into());
    }
    if let Some(format) = stored.format.as_ref() {
        format.validate()?;
    }
    let mut ids = HashSet::new();
    for note in &stored.notes {
        if note.id.is_empty()
            || note.id.len() > 100
            || !ids.insert(note.id.as_str())
            || note.title.encode_utf16().count() > 120
            || note.created_at.is_empty()
            || note.updated_at.is_empty()
            || note.created_at.len() > 40
            || note.updated_at.len() > 40
        {
            return Err("笔记内容无效或超过长度限制".into());
        }
        if let Some(body) = note.body.as_ref() {
            if body.encode_utf16().count() > 100_000 {
                return Err("笔记内容无效或超过长度限制".into());
            }
        }
        if let Some(filename) = note.filename.as_ref() {
            validate_filename(filename)?;
        }
    }
    if stored
        .active_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id.as_str()))
    {
        return Err("当前笔记引用无效".into());
    }
    Ok(())
}

pub fn load(directory: &Path) -> Result<Option<Payload>, String> {
    load_inner(directory, true)
}

/// `migrate` 为假时只读不写：用于旧数据目录，读取时保持原文件字节不变。
fn load_inner(directory: &Path, migrate: bool) -> Result<Option<Payload>, String> {
    let Some(stored) = read_stored(directory)? else {
        return Ok(None);
    };
    validate_stored(&stored)?;
    // 已有的文件名先占位，避免改造前的旧笔记把别人的文件顶掉。
    let mut used: HashSet<String> = stored
        .notes
        .iter()
        .filter_map(|note| note.filename.clone())
        .collect();
    let mut migrated = false;
    let mut notes = Vec::new();
    for note in &stored.notes {
        let filename = match note.filename.clone() {
            Some(filename) => filename,
            None => {
                migrated = true;
                let name = unique_name(slugify(&note.title, &note.id), &used);
                used.insert(name.clone());
                name
            }
        };
        let body = match note.body.clone() {
            Some(body) => {
                migrated = true;
                body
            }
            None => read_body(directory, &filename)?,
        };
        notes.push(PayloadNote {
            id: note.id.clone(),
            title: note.title.clone(),
            filename,
            body,
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
            trashed: note.trashed,
        });
    }
    let payload = Payload {
        version: 1,
        notes,
        active_id: stored.active_id.clone(),
        theme: stored.theme.clone(),
        format: stored.format.clone().unwrap_or_default(),
    };
    if migrated && migrate {
        save(directory, &payload)?;
    }
    Ok(Some(payload))
}

pub fn save(directory: &Path, payload: &Payload) -> Result<(), String> {
    if payload.version != 1 || payload.notes.len() > 100 {
        return Err("笔记版本不受支持或笔记数量超过 100 篇".into());
    }
    if !valid_theme(&payload.theme) {
        return Err("主题配置无效".into());
    }
    payload.format.validate()?;
    let mut ids = HashSet::new();
    for note in &payload.notes {
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
        // 空文件名表示由标题推导；非空则必须是安全的普通文件名。
        if !note.filename.is_empty() {
            validate_filename(&note.filename)?;
        }
    }
    if payload
        .active_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id.as_str()))
    {
        return Err("当前笔记引用无效".into());
    }

    let previous = read_stored(directory)?;
    if let Some(previous) = previous.as_ref() {
        validate_stored(previous)?;
    }
    // 现有文件名先全部占位：重命名只发生在目标名还没被任何笔记使用的时候。
    let taken: HashSet<&str> = payload
        .notes
        .iter()
        .filter(|note| !note.filename.is_empty())
        .map(|note| note.filename.as_str())
        .collect();
    let mut used = HashSet::new();
    let mut planned = Vec::new();
    for note in &payload.notes {
        let slug = slugify(&note.title, &note.id);
        let wanted = if note.filename.is_empty() || note.filename == slug {
            slug
        } else if used.contains(&slug) || taken.contains(slug.as_str()) {
            note.filename.clone()
        } else {
            slug
        };
        let filename = unique_name(wanted, &used);
        used.insert(filename.clone());
        planned.push((filename, note.body.as_str()));
    }
    let mut meta = meta_from(payload);
    for (note, (filename, _)) in meta.notes.iter_mut().zip(&planned) {
        note.filename = filename.clone();
    }

    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    // 先写正文，再换元数据：中途失败时旧元数据仍指向完整的旧内容。
    for (filename, body) in &planned {
        validate_filename(filename)?;
        let path = directory.join(filename);
        if fs::read(&path).is_ok_and(|current| current == body.as_bytes()) {
            continue;
        }
        write_atomic(&path, body.as_bytes())
            .map_err(|error| format!("保存笔记 {filename} 失败：{error}"))?;
    }
    let bytes = serde_json::to_vec(&meta).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("笔记文件超过 24 MB，未覆盖原文件".into());
    }
    let path = directory.join(WORKSPACE_FILE);
    if path.exists() {
        // 无法读取或版本不明的原文件一律不覆盖。
        read_stored(directory)?.ok_or("笔记文件在保存过程中消失，未覆盖任何内容")?;
        fs::copy(&path, directory.join("workspace.json.bak"))
            .map_err(|error| format!("备份笔记失败：{error}"))?;
    }
    write_atomic(&path, &bytes).map_err(|error| format!("替换笔记文件失败：{error}"))?;
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("笔记已写入，但磁盘同步失败：{error}"))?;

    // 只清理上一份元数据里由本应用管理的文件；用户自己放进来的 .txt 不动。
    if let Some(previous) = previous {
        for note in &previous.notes {
            if let Some(filename) = note.filename.as_ref() {
                if !used.contains(filename) {
                    let _ = fs::remove_file(directory.join(filename));
                }
            }
        }
    }
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

    pub fn load(&self) -> Result<Option<Payload>, String> {
        let settings = self.settings()?;
        let directory = settings.data_directory.as_ref().unwrap_or(&self.default);
        if let Some(workspace) = load(directory)? {
            return Ok(Some(workspace));
        }
        if settings.data_directory.is_some() {
            return Err("指定目录中的 workspace.json 不存在，请检查磁盘或恢复文件后重试".into());
        }
        if let Some(legacy) = self.legacy.as_ref().filter(|path| *path != directory) {
            // 旧目录只读：迁移结果写入当前数据目录，旧文件保持原样。
            if let Some(workspace) = load_inner(legacy, false)? {
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

    fn sample() -> Payload {
        Payload {
            version: 1,
            notes: vec![PayloadNote {
                id: "note-1".into(),
                title: "预算".into(),
                filename: "预算.txt".into(),
                body: "0.1 + 0.2".into(),
                created_at: "2026-09-06T00:00:00.000Z".into(),
                updated_at: "2026-09-06T00:00:00.000Z".into(),
                trashed: false,
            }],
            active_id: Some("note-1".into()),
            theme: "paper".into(),
            format: FormatSettings::default(),
        }
    }

    fn temporary(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("calcbook-{name}-{unique}"))
    }

    #[test]
    fn bodies_live_in_txt_files_and_metadata_keeps_them_in_sync() {
        let directory = temporary("roundtrip");
        assert!(load(&directory).unwrap().is_none());
        let mut workspace = sample();
        save(&directory, &workspace).unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "0.1 + 0.2"
        );
        let meta: Meta =
            serde_json::from_slice(&fs::read(directory.join(WORKSPACE_FILE)).unwrap()).unwrap();
        assert_eq!(meta.notes[0].filename, "预算.txt");
        assert!(
            !fs::read_to_string(directory.join(WORKSPACE_FILE))
                .unwrap()
                .contains("0.1 + 0.2"),
            "元数据不应重复保存正文"
        );
        assert_eq!(load(&directory).unwrap().unwrap(), workspace);

        // 改标题会跟着改文件名，旧文件清理掉，正文保留。
        let original = fs::read(directory.join(WORKSPACE_FILE)).unwrap();
        workspace.notes[0].title = "新预算".into();
        workspace.notes[0].body = "changed".into();
        save(&directory, &workspace).unwrap();
        // 文件名由存储层决定，前端保存后以 load 的结果为准。
        workspace.notes[0].filename = "新预算.txt".into();
        assert_eq!(load(&directory).unwrap().unwrap(), workspace);
        assert_eq!(
            fs::read_to_string(directory.join("新预算.txt")).unwrap(),
            "changed"
        );
        assert!(!directory.join("预算.txt").exists());
        assert_eq!(
            fs::read(directory.join("workspace.json.bak")).unwrap(),
            original
        );

        // 用户自己放进目录的 .txt 不会被当成孤儿删除。
        fs::write(directory.join("Numi 笔记.txt"), "# 别人的文件").unwrap();
        save(&directory, &workspace).unwrap();
        assert!(directory.join("Numi 笔记.txt").exists());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_workspaces_never_overwrite_existing_files() {
        let directory = temporary("invalid");
        let workspace = sample();
        save(&directory, &workspace).unwrap();
        let current = fs::read(directory.join(WORKSPACE_FILE)).unwrap();
        let body = fs::read(directory.join("预算.txt")).unwrap();

        let mut invalid = workspace.clone();
        invalid.version = 2;
        assert!(save(&directory, &invalid).is_err());
        invalid = workspace.clone();
        invalid.notes.push(invalid.notes[0].clone());
        assert!(save(&directory, &invalid).is_err());
        invalid = workspace.clone();
        invalid.notes[0].filename = "../escape.txt".into();
        assert!(save(&directory, &invalid).is_err());
        invalid = workspace.clone();
        invalid.active_id = Some("missing".into());
        assert!(save(&directory, &invalid).is_err());
        assert_eq!(fs::read(directory.join(WORKSPACE_FILE)).unwrap(), current);
        assert_eq!(fs::read(directory.join("预算.txt")).unwrap(), body);

        fs::write(directory.join(WORKSPACE_FILE), b"broken-json").unwrap();
        assert!(load(&directory).is_err());
        assert!(save(&directory, &workspace).is_err());
        assert_eq!(
            fs::read(directory.join(WORKSPACE_FILE)).unwrap(),
            b"broken-json"
        );

        // 元数据还在但正文文件丢失时，明确报错而不是当成空笔记。
        fs::write(directory.join(WORKSPACE_FILE), &current).unwrap();
        fs::remove_file(directory.join("预算.txt")).unwrap();
        assert!(load(&directory).is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn single_file_workspaces_are_migrated_into_txt_files() {
        let directory = temporary("migrate");
        fs::create_dir_all(&directory).unwrap();
        let legacy = serde_json::json!({
            "version": 1,
            "notes": [
                {
                    "id": "note-1",
                    "title": "人体消耗计算",
                    "body": "# 人体消耗计算\nBMR = 1,566.25",
                    "createdAt": "2026-09-06T00:00:00.000Z",
                    "updatedAt": "2026-09-06T00:00:00.000Z",
                    "trashed": false
                },
                {
                    "id": "note-2",
                    "title": "人体消耗计算",
                    "body": "重名",
                    "createdAt": "2026-09-06T00:00:00.000Z",
                    "updatedAt": "2026-09-06T00:00:00.000Z",
                    "trashed": true
                }
            ],
            "activeId": "note-1",
            "theme": "midnight",
            "calculatorMode": "dialog"
        });
        fs::write(
            directory.join(WORKSPACE_FILE),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();

        let migrated = load(&directory).unwrap().unwrap();
        assert_eq!(migrated.theme, "midnight");
        assert_eq!(migrated.notes.len(), 2);
        assert_eq!(migrated.notes[0].filename, "人体消耗计算.txt");
        assert_eq!(migrated.notes[1].filename, "人体消耗计算 2.txt");
        assert_eq!(
            fs::read_to_string(directory.join("人体消耗计算.txt")).unwrap(),
            "# 人体消耗计算\nBMR = 1,566.25"
        );
        assert_eq!(
            fs::read_to_string(directory.join("人体消耗计算 2.txt")).unwrap(),
            "重名"
        );
        // 迁移后元数据不再内联正文，旧文件留了一份备份。
        let meta = fs::read_to_string(directory.join(WORKSPACE_FILE)).unwrap();
        assert!(!meta.contains("BMR"));
        assert!(directory.join("workspace.json.bak").exists());
        assert_eq!(load(&directory).unwrap().unwrap(), migrated);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migration_relocation_and_failed_config_commit_preserve_all_workspaces() {
        let root = temporary("relocation");
        let store = Store {
            config: root.join("config"),
            default: root.join("default"),
            legacy: Some(root.join("legacy")),
        };
        let legacy = store.legacy.clone().unwrap();
        fs::create_dir_all(&legacy).unwrap();
        let mut old = serde_json::to_value(sample()).unwrap();
        old["notes"][0].as_object_mut().unwrap().remove("filename");
        old["theme"] = "dark".into();
        let legacy_bytes = serde_json::to_vec(&old).unwrap();
        fs::write(legacy.join(WORKSPACE_FILE), &legacy_bytes).unwrap();
        let workspace = store.load().unwrap().unwrap();
        assert_eq!(workspace.theme, "dark");
        assert_eq!(load(&store.default).unwrap().unwrap(), workspace);
        assert_eq!(fs::read(legacy.join(WORKSPACE_FILE)).unwrap(), legacy_bytes);

        let mut workspace = workspace;
        workspace.theme = "midnight".into();
        save(&store.directory().unwrap(), &workspace).unwrap();
        let original = fs::read(store.default.join(WORKSPACE_FILE)).unwrap();
        let occupied = root.join("occupied");
        save(&occupied, &sample()).unwrap();
        let occupied_bytes = fs::read(occupied.join(WORKSPACE_FILE)).unwrap();
        assert!(store.relocate(&occupied).is_err());
        assert_eq!(store.directory().unwrap(), store.default);
        assert_eq!(
            fs::read(occupied.join(WORKSPACE_FILE)).unwrap(),
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
            fs::read(store.default.join(WORKSPACE_FILE)).unwrap(),
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
            fs::read(store.default.join(WORKSPACE_FILE)).unwrap(),
            original
        );
        assert_eq!(fs::read(legacy.join(WORKSPACE_FILE)).unwrap(), legacy_bytes);

        fs::remove_file(target.join(WORKSPACE_FILE)).unwrap();
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

    #[test]
    fn slugify_keeps_readable_names_and_rejects_path_traversal() {
        assert_eq!(slugify("人体消耗计算", "note-1"), "人体消耗计算.txt");
        assert_eq!(slugify("a/b:c", "note-1"), "a-b-c.txt");
        assert_eq!(slugify("  ..  ", "note-1"), "note-1.txt");
        assert_eq!(slugify("", "note-2"), "note-2.txt");
        assert!(validate_filename("预算.txt").is_ok());
        for name in ["", "预算", "../x.txt", "a/b.txt", ".hidden.txt", "预算.md"] {
            assert!(validate_filename(name).is_err(), "{name} 应被拒绝");
        }
    }

    #[test]
    fn format_settings_are_validated_and_default_to_free() {
        let directory = temporary("format-settings");
        let mut workspace = sample();
        workspace.format.unit_style = "chinese".into();
        save(&directory, &workspace).unwrap();
        assert_eq!(load(&directory).unwrap().unwrap(), workspace);

        let mut invalid = workspace.clone();
        invalid.format.unit_style = "traditional".into();
        assert!(save(&directory, &invalid).is_err());

        // 元数据里出现非法单位风格时拒绝读取，不静默回退。
        let path = directory.join(WORKSPACE_FILE);
        let meta: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let mut corrupted = meta.clone();
        corrupted["format"]["unitStyle"] = "traditional".into();
        fs::write(&path, serde_json::to_vec(&corrupted).unwrap()).unwrap();
        assert!(load(&directory).is_err());

        // 旧文件没有 format 字段：按默认格式设置。
        let mut legacy = meta;
        legacy.as_object_mut().unwrap().remove("format");
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let loaded = load(&directory).unwrap().unwrap();
        assert_eq!(loaded.format, FormatSettings::default());
        assert_eq!(loaded.notes, workspace.notes);
        fs::remove_dir_all(directory).unwrap();
    }
}
