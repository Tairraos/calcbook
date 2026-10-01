use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 24_000_000;
const MAX_FILENAME_BYTES: usize = 160;
const WORKSPACE_FILE: &str = "workspace.json";
const RECYCLED_DIR: &str = "recycled";
const HISTORY_DIR: &str = "history";
/// 每个笔记的历史版本空间（KB）：设置里可配，0 = 关闭历史。
pub const DEFAULT_HISTORY_LIMIT_KB: u32 = 128;
pub const MAX_HISTORY_LIMIT_KB: u32 = 65536;
pub const MAX_NOTES: usize = 100;

/// 扫描结果：正文完全以 .txt 文件为事实来源（数据目录 = 笔记，recycled/ = 废纸篓），
/// workspace.json 只保存主题、当前笔记与格式设置。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    version: u8,
    notes: Vec<PayloadNote>,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
    #[serde(default = "default_history_limit_kb", rename = "historyLimitKB")]
    history_limit_kb: u32,
}

fn default_history_limit_kb() -> u32 {
    DEFAULT_HISTORY_LIMIT_KB
}

/// 单篇笔记：id 即文件相对路径（`预算.txt` 或 `recycled/预算.txt`）。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayloadNote {
    id: String,
    #[serde(default)]
    filename: String,
    title: String,
    #[serde(default)]
    body: String,
    created_at: String,
    updated_at: String,
    trashed: bool,
}

/// 落盘的工作区设置（主题、当前笔记、格式、历史空间），不含笔记清单。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSettings {
    version: u8,
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: FormatSettings,
    #[serde(default = "default_history_limit_kb", rename = "historyLimitKB")]
    history_limit_kb: u32,
}

// 兼容读取改造前的格式：正文内联在 workspace.json、笔记清单驱动。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNote {
    id: String,
    title: String,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    trashed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u8,
    #[serde(default)]
    notes: Vec<StoredNote>,
    #[serde(default)]
    active_id: Option<String>,
    theme: String,
    #[serde(default)]
    format: Option<FormatSettings>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormatSettings {
    #[serde(default)]
    thousands: bool,
    #[serde(default = "default_true")]
    result_thousands: bool,
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
            result_thousands: true,
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

fn valid_theme(theme: &str) -> bool {
    matches!(
        theme,
        "light" | "dark" | "paper" | "sand" | "mist" | "forest" | "midnight" | "graphite"
    )
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

/// 用标题生成文件名；标题里不能进文件名的字符换成 `-`，为空时退回给定的兜底名。
pub fn slugify(title: &str, fallback: &str) -> String {
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
        truncate_bytes(fallback, 60)
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

/// 文件名只能是不含路径的普通名称，防止读写被带出数据目录。
fn validate_filename(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if name.is_empty()
        || name.len() > MAX_FILENAME_BYTES
        || name.starts_with('.')
        || !name.ends_with(".txt")
        || path.components().count() != 1
        || path.file_name().is_none_or(|file| file != name)
    {
        return Err("笔记文件名无效".into());
    }
    Ok(())
}

/// 笔记 id（文件相对路径）→ 数据目录内的实际路径；recycled/ 前缀即废纸篓。
/// id 来自前端，这里做路径安全校验。
pub fn resolve_note_path(directory: &Path, note_id: &str) -> Result<(PathBuf, bool), String> {
    const PREFIX: &str = "recycled/";
    let (name, trashed) = if let Some(rest) = note_id.strip_prefix(PREFIX) {
        (rest, true)
    } else {
        (note_id, false)
    };
    validate_filename(name)?;
    let path = if trashed {
        directory.join(RECYCLED_DIR).join(name)
    } else {
        directory.join(name)
    };
    Ok((path, trashed))
}

/// 递归复制目录（历史目录随 relocate 搬家用）。
fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| format!("无法复制笔记历史：{error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("无法复制笔记历史：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法复制笔记历史：{error}"))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| format!("无法复制笔记历史：{error}"))?;
        }
    }
    Ok(())
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

/// Unix 秒 → ISO 8601（UTC）。避免为此引入日期库。
fn iso_timestamp(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant civil_from_days：天数 → 年月日
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn file_timestamps(path: &Path) -> (String, String) {
    let metadata = fs::metadata(path).ok();
    let secs = |time: Option<std::time::SystemTime>| -> i64 {
        time.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0)
    };
    let modified = secs(metadata.as_ref().and_then(|meta| meta.modified().ok()));
    let created = secs(metadata.as_ref().and_then(|meta| meta.created().ok()));
    (iso_timestamp(created), iso_timestamp(modified))
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default();
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取笔记 {name}：{error}。原文件未改动"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "笔记 {name} 超过 24 MB，请把该文件移出笔记文件夹后重试"
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("无法读取笔记 {name}：{error}。原文件未改动"))?;
    String::from_utf8(bytes).map_err(|_| format!("笔记 {name} 不是 UTF-8 文本，原文件未改动"))
}

/// 扫描一个目录层（正常笔记或废纸篓），按更新时间从新到旧排序。
fn scan_layer(
    directory: &Path,
    sub: Option<&str>,
    trashed: bool,
) -> Result<Vec<PayloadNote>, String> {
    let base = match sub {
        Some(sub) => directory.join(sub),
        None => directory.to_path_buf(),
    };
    let mut entries: Vec<(PathBuf, String, std::time::SystemTime)> = Vec::new();
    for entry in fs::read_dir(&base).map_err(|error| format!("无法读取笔记目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取笔记目录：{error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") || name.starts_with('.') || name.ends_with(".tmp") {
            continue;
        }
        if validate_filename(&name).is_err() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        entries.push((
            path,
            name,
            std::time::UNIX_EPOCH + std::time::Duration::from_secs(modified),
        ));
    }
    // 最近更新的先出现在列表里
    entries.sort_by_key(|(_, _, modified)| std::cmp::Reverse(*modified));
    let mut notes = Vec::new();
    for (path, name, _) in entries {
        let body = read_text_file(&path)?;
        let (created_at, updated_at) = file_timestamps(&path);
        let stem = name.strip_suffix(".txt").unwrap_or(&name).to_string();
        let id = match sub {
            Some(sub) => format!("{sub}/{name}"),
            None => name.clone(),
        };
        notes.push(PayloadNote {
            id,
            filename: String::new(),
            // 标题即文件名主干（无扩展名）；正文里的 `#` 只是内容标记
            title: stem,
            body,
            created_at,
            updated_at,
            trashed,
        });
    }
    Ok(notes)
}

/// 启动扫描：数据目录与 recycled/ 下的全部 .txt 都是笔记。
/// 外部新增/删除的文件在扫描时自动同步；孤儿历史目录一并清理。
pub fn scan(directory: &Path) -> Result<Payload, String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let settings = read_workspace_settings(directory)?;
    let mut notes = scan_layer(directory, None, false)?;
    notes.extend(scan_layer(directory, Some(RECYCLED_DIR), true)?);
    if notes.len() > MAX_NOTES {
        return Err(format!(
            "笔记文件夹里有 {} 篇笔记，超过 {} 篇上限，请移出部分文件后重试",
            notes.len(),
            MAX_NOTES
        ));
    }
    // 历史空间设为 0（关闭）：启动时清空全部历史；否则只清理孤儿目录
    if settings.history_limit_kb == 0 {
        let _ = fs::remove_dir_all(directory.join(HISTORY_DIR));
    } else {
        prune_history(directory, &notes);
    }
    let active_id = settings
        .active_id
        .filter(|id| notes.iter().any(|note| note.id == *id));
    Ok(Payload {
        version: 1,
        notes,
        active_id,
        theme: settings.theme,
        format: settings.format,
        history_limit_kb: settings.history_limit_kb,
    })
}

fn read_workspace_settings(directory: &Path) -> Result<WorkspaceSettings, String> {
    let path = directory.join(WORKSPACE_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceSettings {
                version: 1,
                active_id: None,
                theme: "light".into(),
                format: FormatSettings::default(),
                history_limit_kb: default_history_limit_kb(),
            });
        }
        Err(error) => return Err(format!("无法读取笔记：{error}")),
    };
    // 旧版清单格式（notes 内联）先迁移成 .txt 文件，再读取设置
    let probe: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if probe.get("notes").is_some() {
        migrate_legacy(directory)?;
        let fresh = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
        let mut settings: WorkspaceSettings = serde_json::from_slice(&fresh)
            .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
        settings.format.validate()?;
        settings.history_limit_kb = settings.history_limit_kb.min(MAX_HISTORY_LIMIT_KB);
        return Ok(settings);
    }
    let mut settings: WorkspaceSettings = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if !valid_theme(&settings.theme) {
        return Err("主题配置无效".into());
    }
    settings.format.validate()?;
    // 手工改动的历史空间超限时钳制，不阻塞启动
    settings.history_limit_kb = settings.history_limit_kb.min(MAX_HISTORY_LIMIT_KB);
    Ok(settings)
}

/// 旧版单文件工作区（notes 内联）的迁移：正文写成 .txt、废纸篓移入 recycled/，
/// workspace.json 重写为只含设置；原文件备份为 workspace.json.bak。
fn migrate_legacy(directory: &Path) -> Result<(), String> {
    let path = directory.join(WORKSPACE_FILE);
    let bytes = fs::read(&path).map_err(|error| format!("无法读取笔记：{error}"))?;
    let stored: Stored = serde_json::from_slice(&bytes)
        .map_err(|error| format!("笔记文件损坏，原文件已保留：{error}"))?;
    if stored.version != 1 {
        return Err("笔记版本不受支持".into());
    }
    if !valid_theme(&stored.theme) {
        return Err("主题配置无效".into());
    }
    let format = stored.format.clone().unwrap_or_default();
    format.validate()?;
    fs::copy(&path, directory.join("workspace.json.bak"))
        .map_err(|error| format!("备份笔记失败：{error}"))?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let mut used: HashSet<String> = HashSet::new();
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取笔记目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取笔记目录：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".txt") {
            used.insert(name);
        }
    }
    for note in &stored.notes {
        let filename = match note.filename.as_deref().filter(|name| !name.is_empty()) {
            Some(filename) => filename.to_string(),
            None => unique_name(slugify(&note.title, &note.id), &used),
        };
        used.insert(filename.clone());
        let target_dir = if note.trashed {
            directory.join(RECYCLED_DIR)
        } else {
            directory.to_path_buf()
        };
        let target = target_dir.join(&filename);
        if !target.exists() {
            if let Some(body) = note.body.as_deref() {
                write_atomic(&target, body.as_bytes())
                    .map_err(|error| format!("迁移笔记 {filename} 失败：{error}"))?;
            }
        }
    }
    let settings = WorkspaceSettings {
        version: 1,
        active_id: stored.active_id.clone(),
        theme: stored.theme.clone(),
        format,
        history_limit_kb: default_history_limit_kb(),
    };
    let out = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    write_atomic(&path, &out).map_err(|error| format!("替换笔记文件失败：{error}"))
}

pub fn save_settings(
    directory: &Path,
    theme: &str,
    active_id: Option<&str>,
    format: &FormatSettings,
    history_limit_kb: u32,
) -> Result<(), String> {
    if !valid_theme(theme) {
        return Err("主题配置无效".into());
    }
    format.validate()?;
    if history_limit_kb > MAX_HISTORY_LIMIT_KB {
        return Err("历史空间配置无效".into());
    }
    // 当前笔记必须真实存在（数据目录或 recycled/），否则丢弃引用
    let mut used: HashSet<String> = HashSet::new();
    for place in [directory.to_path_buf(), directory.join(RECYCLED_DIR)] {
        if let Ok(entries) = fs::read_dir(&place) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".txt") {
                    used.insert(name);
                }
            }
        }
    }
    let active_id = active_id.filter(|id| {
        let name = id.strip_prefix("recycled/").unwrap_or(id);
        used.contains(name)
    });
    let settings = WorkspaceSettings {
        version: 1,
        active_id: active_id.map(|id| id.to_string()),
        theme: theme.to_string(),
        format: format.clone(),
        history_limit_kb,
    };
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    write_atomic(&directory.join(WORKSPACE_FILE), &bytes)
        .map_err(|error| format!("替换笔记文件失败：{error}"))
}

// 会话内笔记可能在数据目录与 recycled/ 之间移动，而前端 id 恒为无前缀形态：
// 写/删/确保都以「两个位置里真实存在的那份」为准。
fn locate_note(directory: &Path, note_id: &str) -> Result<(PathBuf, bool), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    if normal.exists() {
        return Ok((normal, false));
    }
    if recycled_path.exists() {
        return Ok((recycled_path, true));
    }
    Ok((normal, false))
}

fn resolve_pair(directory: &Path, note_id: &str) -> Result<(PathBuf, PathBuf), String> {
    // id 可能带 recycled/ 前缀（扫描废纸篓后的形态）：两个位置都按同一文件名解析，
    // 改名、恢复与写入在任一形态下都落在真实文件上。
    let name = note_id
        .strip_prefix("recycled/")
        .unwrap_or(note_id)
        .to_string();
    validate_filename(&name)?;
    Ok((
        directory.join(&name),
        directory.join(RECYCLED_DIR).join(name),
    ))
}

/// 写单篇笔记（新建与覆盖同一路径；文件不存在即创建）。
pub fn write_note(directory: &Path, note_id: &str, body: &str) -> Result<(), String> {
    let (path, _) = locate_note(directory, note_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    }
    write_atomic(&path, body.as_bytes()).map_err(|error| format!("保存笔记失败：{error}"))
}

/// 废纸篓进出：文件在数据目录与 recycled/ 之间改名。
pub fn move_note(directory: &Path, note_id: &str, to_recycled: bool) -> Result<(), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    fs::create_dir_all(directory.join(RECYCLED_DIR))
        .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
    let (source, target) = if to_recycled {
        (normal, recycled_path)
    } else {
        (recycled_path, normal)
    };
    if !source.exists() {
        return Err("笔记文件不存在".into());
    }
    if target.exists() {
        return Err("同名文件已存在".into());
    }
    fs::rename(&source, &target).map_err(|error| format!("无法移动笔记：{error}"))
}

/// 永久删除单篇笔记文件：数据目录与 recycled/ 两个位置都清理；不存在时视为成功。
/// 历史目录一并删除，保持「永久删除不可恢复」的承诺。
pub fn delete_note(directory: &Path, note_id: &str) -> Result<(), String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    for path in [normal, recycled_path] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法删除笔记：{error}")),
        }
    }
    let history = history_dir(directory, note_id)?;
    if history.exists() {
        fs::remove_dir_all(&history).map_err(|error| format!("无法删除笔记历史：{error}"))?;
    }
    Ok(())
}

/// 历史条目：name 是时间桶（`年-月-日-时-分-秒`，旧数据为整点 `年-月-日-时`），content 是当时的文件正文。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub name: String,
    pub content: String,
}

/// 笔记的历史目录：`history/<文件名主干>/`，废纸篓前缀不影响归属。
fn history_dir(directory: &Path, note_id: &str) -> Result<PathBuf, String> {
    let name = note_id
        .strip_prefix("recycled/")
        .unwrap_or(note_id)
        .to_string();
    validate_filename(&name)?;
    let stem = name.strip_suffix(".txt").unwrap_or(&name);
    Ok(directory.join(HISTORY_DIR).join(stem))
}

/// 时间桶格式：`年-月-日-时-分-秒`（19 字符，本地时间，由前端生成避免 Rust 引日期库）。
fn validate_bucket(bucket: &str) -> bool {
    let bytes = bucket.as_bytes();
    if bytes.len() != 19 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        let separator = matches!(index, 4 | 7 | 10 | 13 | 16);
        if separator != (*byte == b'-') {
            return false;
        }
        if !separator && !byte.is_ascii_digit() {
            return false;
        }
    }
    true
}

/// 时间桶的小时前缀（前 13 字符）。兼容旧版 13 字符的整点文件名。
fn hour_prefix(name: &str) -> Option<&str> {
    match name.len() {
        13 | 19 => {
            let prefix = &name[..13];
            validate_bucket(&format!("{prefix}-00-00")).then_some(prefix)
        }
        _ => None,
    }
}

/// 记录一份历史：时间戳即文件名（`年-月-日-时-分-秒.txt`），当前小时内可以有多份；
/// 写完先把超出当前小时的每小时多份整理为一份整点快照，再按单篇历史上限（字节）从最早淘汰
/// （最新一份永不淘汰）。limit_bytes 为 0 表示历史已关闭：清空该笔记的既有历史，不写入。
/// 时间戳由前端按本地时间生成，这里只做格式校验。
pub fn record_history(
    directory: &Path,
    note_id: &str,
    content: &str,
    bucket: &str,
    limit_bytes: u64,
) -> Result<(), String> {
    if !validate_bucket(bucket) {
        return Err("历史时间戳无效".into());
    }
    let dir = history_dir(directory, note_id)?;
    if limit_bytes == 0 {
        // 历史已关闭：编辑到哪篇就清哪篇的既有历史
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|error| format!("无法清理笔记历史：{error}"))?;
        }
        return Ok(());
    }
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建笔记历史：{error}"))?;
    write_atomic(&dir.join(format!("{bucket}.txt")), content.as_bytes())
        .map_err(|error| format!("无法写入笔记历史：{error}"))?;
    compact_history(&dir, &bucket[..13])?;
    enforce_history_cap(&dir, limit_bytes)
}

/// 整理历史：当前小时之外，每小时多于一份时只保留最后一份，并改名为整点
/// （`年-月-日-时-00-00`）。兼容旧版 13 字符整点文件名；不合时间格式的文件不动。
fn compact_history(dir: &Path, current_hour: &str) -> Result<(), String> {
    let mut by_hour: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for entry in fs::read_dir(dir).map_err(|error| format!("无法读取笔记历史：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取笔记历史：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") || name.ends_with(".tmp") {
            continue;
        }
        let stem = name.strip_suffix(".txt").unwrap_or(&name);
        if let Some(hour) = hour_prefix(stem) {
            by_hour.entry(hour.to_string()).or_default().push(name);
        }
    }
    for (hour, mut names) in by_hour {
        if hour == current_hour || names.len() <= 1 {
            continue;
        }
        names.sort();
        let keep = names.pop().expect("该小时至少有两份历史");
        for name in &names {
            fs::remove_file(dir.join(name))
                .map_err(|error| format!("无法整理笔记历史：{error}"))?;
        }
        let target = format!("{hour}-00-00");
        if keep != target {
            fs::rename(dir.join(keep), dir.join(format!("{target}.txt")))
                .map_err(|error| format!("无法整理笔记历史：{error}"))?;
        }
    }
    Ok(())
}

/// 单篇历史总量超限时，按时间桶从最早开始删除，直到回到上限内；最新一份始终保留。
fn enforce_history_cap(dir: &Path, limit_bytes: u64) -> Result<(), String> {
    let mut entries: Vec<(String, u64)> = Vec::new();
    let mut total: u64 = 0;
    for entry in fs::read_dir(dir).map_err(|error| format!("无法读取笔记历史：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取笔记历史：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") || name.ends_with(".tmp") {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        total += size;
        entries.push((name, size));
    }
    if total <= limit_bytes {
        return Ok(());
    }
    // 时间桶名字典序即时间序；逐个删除最早的。最新一份不参与淘汰：
    // 单篇快照本身可能超过上限（超大笔记），删到只剩它为止，历史不至于全空。
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries.pop();
    for (name, size) in entries {
        if total <= limit_bytes {
            break;
        }
        fs::remove_file(dir.join(&name)).map_err(|error| format!("无法清理笔记历史：{error}"))?;
        total -= size;
    }
    Ok(())
}

/// 删除单条历史（弹窗里的删除图标）。bucket 是秒级时间戳或旧版整点名；
/// 文件不存在时视为成功。历史目录删空后一并移除。
pub fn delete_history(directory: &Path, note_id: &str, bucket: &str) -> Result<(), String> {
    let valid = validate_bucket(bucket) || hour_prefix(bucket).is_some();
    if !valid {
        return Err("历史时间戳无效".into());
    }
    let dir = history_dir(directory, note_id)?;
    match fs::remove_file(dir.join(format!("{bucket}.txt"))) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("无法删除笔记历史：{error}")),
    }
    // 目录已空时清掉，避免留下空目录
    if dir.exists()
        && fs::read_dir(&dir)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false)
    {
        let _ = fs::remove_dir(&dir);
    }
    Ok(())
}

/// 列出单篇笔记的全部历史，最新在前；列出前先整理旧小时（与磁盘保持一致）。
/// currentHour 是前端本地时间的小时前缀，格式不对时跳过整理只列清单。
pub fn list_history(
    directory: &Path,
    note_id: &str,
    current_hour: &str,
) -> Result<Vec<HistoryEntry>, String> {
    let dir = history_dir(directory, note_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    if validate_bucket(&format!("{current_hour}-00-00")) {
        compact_history(&dir, current_hour)?;
    }
    let mut entries: Vec<HistoryEntry> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| format!("无法读取笔记历史：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取笔记历史：{error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".txt") || name.ends_with(".tmp") {
            continue;
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        entries.push(HistoryEntry {
            name: name.strip_suffix(".txt").unwrap_or(&name).to_string(),
            content,
        });
    }
    entries.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(entries)
}

/// 改名时历史目录跟随文件名移动（没有历史时是空操作）。
fn move_history(directory: &Path, old_note_id: &str, new_note_id: &str) -> Result<(), String> {
    let old_dir = history_dir(directory, old_note_id)?;
    let new_dir = history_dir(directory, new_note_id)?;
    if old_dir == new_dir || !old_dir.exists() {
        return Ok(());
    }
    if let Some(parent) = new_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建笔记历史：{error}"))?;
    }
    fs::rename(&old_dir, &new_dir).map_err(|error| format!("无法移动笔记历史：{error}"))
}

/// 启动清理：history/ 下不再对应任何笔记（含废纸篓）的目录删除。
/// 应对外部改名/删除与手工操作留下的孤儿目录；尽力而为，失败不阻塞启动。
fn prune_history(directory: &Path, notes: &[PayloadNote]) {
    let history = directory.join(HISTORY_DIR);
    let Ok(entries) = fs::read_dir(&history) else {
        return;
    };
    let stems: HashSet<String> = notes
        .iter()
        .map(|note| {
            let name = note.id.strip_prefix("recycled/").unwrap_or(&note.id);
            name.strip_suffix(".txt").unwrap_or(name).to_string()
        })
        .collect();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !stems.contains(&name) {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// 运行期间文件被外部删除时：点击笔记即重建同名空文件（内存中的正文会在下次保存写回）。
pub fn ensure_note(directory: &Path, note_id: &str) -> Result<bool, String> {
    let (normal, recycled_path) = resolve_pair(directory, note_id)?;
    if normal.exists() || recycled_path.exists() {
        return Ok(false);
    }
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    write_atomic(&normal, b"").map_err(|error| format!("无法重建笔记：{error}"))?;
    Ok(true)
}

/// 改名结果：id 是含 recycled/ 前缀的文件相对路径，title 是去掉 .txt 的主干。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub id: String,
    pub title: String,
}

/// 改名：标题即文件名主干。撞名自动加序号，废纸篓里的笔记留在原层级。
pub fn rename_note(directory: &Path, note_id: &str, title: &str) -> Result<RenameResult, String> {
    let (path, trashed) = locate_note(directory, note_id)?;
    if !path.exists() {
        return Err("笔记文件不存在".into());
    }
    let current_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or("笔记文件名无效")?;
    // 用户可能顺手带上扩展名：统一剥掉再生成（走 Path 解析，不会切进多字节字符）
    let requested = title.trim();
    let requested = match Path::new(requested).extension() {
        Some(ext) if ext.eq_ignore_ascii_case("txt") => Path::new(requested)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(requested),
        _ => requested,
    };
    let desired = slugify(requested, "未命名");
    if desired == current_name {
        let stem = desired.strip_suffix(".txt").unwrap_or(&desired).to_string();
        return Ok(RenameResult {
            id: note_id.to_string(),
            title: stem,
        });
    }
    let mut used: HashSet<String> = HashSet::new();
    for place in [directory.to_path_buf(), directory.join(RECYCLED_DIR)] {
        if let Ok(entries) = fs::read_dir(&place) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".txt") {
                    used.insert(name);
                }
            }
        }
    }
    used.remove(&current_name);
    let filename = unique_name(desired, &used);
    let target = match path.parent() {
        Some(parent) => parent.join(&filename),
        None => return Err("笔记文件名无效".into()),
    };
    fs::rename(&path, &target).map_err(|error| format!("无法重命名笔记：{error}"))?;
    let stem = filename
        .strip_suffix(".txt")
        .unwrap_or(&filename)
        .to_string();
    let id = if trashed {
        format!("{RECYCLED_DIR}/{filename}")
    } else {
        filename
    };
    move_history(directory, note_id, &id)?;
    Ok(RenameResult { id, title: stem })
}

/// 新建笔记：标题生成唯一文件名，正文落盘，返回笔记。
pub fn create_note(directory: &Path, title: &str, body: &str) -> Result<PayloadNote, String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建笔记目录：{error}"))?;
    let mut used: HashSet<String> = HashSet::new();
    for place in [directory.to_path_buf(), directory.join(RECYCLED_DIR)] {
        if let Ok(entries) = fs::read_dir(&place) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".txt") {
                    used.insert(name);
                }
            }
        }
    }
    if used.len() >= MAX_NOTES {
        return Err(format!("笔记数量已达 {} 篇上限", MAX_NOTES));
    }
    let filename = unique_name(slugify(title, "未命名"), &used);
    write_atomic(&directory.join(&filename), body.as_bytes())
        .map_err(|error| format!("保存笔记失败：{error}"))?;
    let (created_at, updated_at) = file_timestamps(&directory.join(&filename));
    Ok(PayloadNote {
        id: filename.clone(),
        filename: String::new(),
        // 标题即文件名主干；正文保持用户输入，不再强制加 `# 标题` 首行
        title: filename
            .strip_suffix(".txt")
            .unwrap_or(&filename)
            .to_string(),
        body: body.to_string(),
        created_at,
        updated_at,
        trashed: false,
    })
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

/// 上次关闭时的主窗尺寸（逻辑单位），存默认数据目录 ~/.calcbook/window.json。
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

/// 与 tauri.conf.json 的 minWidth/minHeight 保持一致。
pub const MIN_WINDOW_WIDTH: f64 = 800.0;
pub const MIN_WINDOW_HEIGHT: f64 = 640.0;

impl WindowSize {
    /// 钳制到主窗最小尺寸，恢复时不会比最小窗口还小。
    pub fn clamped(self) -> Self {
        Self {
            width: self.width.max(MIN_WINDOW_WIDTH),
            height: self.height.max(MIN_WINDOW_HEIGHT),
        }
    }
}

impl Store {
    /// 读取上次记录的窗口尺寸；文件缺失或损坏时返回 None（回退最小尺寸）。
    pub fn window_size(&self) -> Option<WindowSize> {
        let bytes = fs::read(self.default.join("window.json")).ok()?;
        let size: WindowSize = serde_json::from_slice(&bytes).ok()?;
        (size.width.is_finite() && size.height.is_finite()).then_some(size)
    }

    /// 记录窗口尺寸：先钳制到最小尺寸，再按既有模式原子写入。
    pub fn save_window_size(&self, size: WindowSize) -> Result<(), String> {
        let size = size.clamped();
        fs::create_dir_all(&self.default).map_err(|error| format!("无法创建数据目录：{error}"))?;
        let bytes = serde_json::to_vec_pretty(&size)
            .map_err(|error| format!("无法序列化窗口尺寸：{error}"))?;
        let temporary = self.default.join("window.json.tmp");
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法暂存窗口尺寸：{error}"))?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("窗口尺寸未保存：{error}"))?;
        drop(file);
        fs::rename(temporary, self.default.join("window.json"))
            .map_err(|error| format!("窗口尺寸未保存：{error}"))?;
        Ok(())
    }

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
        let has_own = directory.join(WORKSPACE_FILE).exists()
            || directory.join(RECYCLED_DIR).exists()
            || fs::read_dir(directory)
                .map(|entries| {
                    entries
                        .flatten()
                        .any(|entry| entry.file_name().to_string_lossy().ends_with(".txt"))
                })
                .unwrap_or(false);
        if has_own {
            return Ok(Some(scan(directory)?));
        }
        if settings.data_directory.is_some() {
            return Err("指定目录中没有任何笔记，请检查磁盘或恢复文件后重试".into());
        }
        if let Some(legacy) = self.legacy.as_ref().filter(|path| *path != directory) {
            let has_legacy = fs::read_dir(legacy)
                .map(|entries| {
                    entries.flatten().any(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();
                        name == WORKSPACE_FILE || name.ends_with(".txt")
                    })
                })
                .unwrap_or(false);
            if has_legacy {
                let payload = scan(legacy)?;
                // 旧目录的文件全部搬进当前数据目录（recycled/ 结构原样保留）
                for note in &payload.notes {
                    let source = legacy.join(&note.id);
                    let target = directory.join(&note.id);
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)
                            .map_err(|error| format!("无法创建笔记目录：{error}"))?;
                    }
                    fs::rename(&source, &target)
                        .or_else(|_| fs::copy(&source, &target).map(|_| ()))
                        .map_err(|error| format!("无法迁移旧笔记：{error}"))?;
                }
                let _ = fs::remove_file(legacy.join(WORKSPACE_FILE));
                return Ok(Some(scan(directory)?));
            }
        }
        Ok(None)
    }

    /// 换目录：目标文件夹必须是空的（没有 .txt 与 workspace.json），否则拒绝覆盖；
    /// 把全部笔记文件、recycled/ 与 workspace.json 复制过去后再提交配置。
    pub fn relocate(&self, target: &Path) -> Result<(), String> {
        let target =
            fs::canonicalize(target).map_err(|error| format!("无法打开所选目录：{error}"))?;
        if !target.is_dir() {
            return Err("请选择一个文件夹".into());
        }
        let current = self.directory()?;
        if fs::canonicalize(&current).ok().as_ref() == Some(&target) {
            return Ok(());
        }
        let occupied = fs::read_dir(&target)
            .map_err(|error| format!("无法读取所选目录：{error}"))?
            .flatten()
            .any(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.ends_with(".txt") || name == WORKSPACE_FILE
            });
        if occupied {
            return Err("所选文件夹已包含笔记，未覆盖。请选择空文件夹".into());
        }
        let payload = scan(&current)?;
        for note in &payload.notes {
            let source = current.join(&note.id);
            let target_path = target.join(&note.id);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("无法创建笔记目录：{error}"))?;
            }
            fs::copy(&source, &target_path).map_err(|error| format!("无法复制笔记：{error}"))?;
        }
        if current.join(RECYCLED_DIR).exists() {
            fs::create_dir_all(target.join(RECYCLED_DIR))
                .map_err(|error| format!("无法创建废纸篓目录：{error}"))?;
        }
        if current.join(HISTORY_DIR).exists() {
            copy_dir_recursive(&current.join(HISTORY_DIR), &target.join(HISTORY_DIR))?;
        }
        let bytes = fs::read(current.join(WORKSPACE_FILE)).unwrap_or_default();
        if !bytes.is_empty() {
            fs::write(target.join(WORKSPACE_FILE), &bytes)
                .map_err(|error| format!("无法复制笔记：{error}"))?;
        }
        // 提交配置：失败时原目录保持不变
        fs::create_dir_all(&self.config).map_err(|error| format!("无法创建配置目录：{error}"))?;
        let settings_bytes = serde_json::to_vec(&Settings {
            data_directory: Some(target.clone()),
        })
        .map_err(|error| error.to_string())?;
        let temporary = self.config.join("settings.json.tmp");
        let mut file =
            fs::File::create(&temporary).map_err(|error| format!("无法暂存配置：{error}"))?;
        file.write_all(&settings_bytes)
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

    #[test]
    fn window_size_round_trips_clamps_and_rejects_garbage() {
        let root = temporary("window-size");
        let store = Store {
            config: root.join("config"),
            default: root.join("data"),
            legacy: None,
        };
        // 无记录时回退 None（启动侧再用最小尺寸兜底）
        assert_eq!(store.window_size(), None);
        // 正常往返
        store
            .save_window_size(WindowSize {
                width: 1280.0,
                height: 820.0,
            })
            .unwrap();
        assert_eq!(
            store.window_size(),
            Some(WindowSize {
                width: 1280.0,
                height: 820.0,
            })
        );
        // 保存时钳制到最小尺寸
        store
            .save_window_size(WindowSize {
                width: 500.0,
                height: 400.0,
            })
            .unwrap();
        assert_eq!(
            store.window_size(),
            Some(WindowSize {
                width: MIN_WINDOW_WIDTH,
                height: MIN_WINDOW_HEIGHT,
            })
        );
        // 损坏文件视为无记录，不阻塞启动
        fs::write(store.default.join("window.json"), "not json").unwrap();
        assert_eq!(store.window_size(), None);
    }

    fn temporary(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("calcbook-{name}-{unique}"))
    }

    #[test]
    fn scan_reads_txt_files_with_recycled_and_titles() {
        let directory = temporary("scan");
        fs::create_dir_all(directory.join(RECYCLED_DIR)).unwrap();
        fs::write(directory.join("预算.txt"), "# 旅行预算\n交通 = 186").unwrap();
        fs::write(directory.join("b.txt"), "没有标题的笔记").unwrap();
        fs::write(directory.join(RECYCLED_DIR).join("旧.txt"), "# 旧的").unwrap();
        fs::write(directory.join("notes.md"), "不是笔记").unwrap();

        let payload = scan(&directory).unwrap();
        let ids: Vec<&str> = payload.notes.iter().map(|note| note.id.as_str()).collect();
        assert_eq!(ids, ["预算.txt", "b.txt", "recycled/旧.txt"]);
        // 标题即文件名主干；正文里的 `#` 只是内容标记
        assert_eq!(payload.notes[0].title, "预算");
        assert!(!payload.notes[0].trashed);
        assert_eq!(payload.notes[1].title, "b");
        assert_eq!(payload.notes[2].title, "旧");
        assert!(payload.notes[2].trashed);
        assert!(payload
            .notes
            .iter()
            .all(|note| !note.created_at.is_empty() && !note.updated_at.is_empty()));
        // 外部删除文件后，下一次扫描自动同步
        fs::remove_file(directory.join("b.txt")).unwrap();
        let payload = scan(&directory).unwrap();
        assert_eq!(payload.notes.len(), 2);
        // 外部新增文件也会被引入
        fs::write(directory.join("新增.txt"), "# 新的").unwrap();
        assert_eq!(scan(&directory).unwrap().notes.len(), 3);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn write_move_delete_and_ensure_cover_the_file_lifecycle() {
        let directory = temporary("lifecycle");
        write_note(&directory, "预算.txt", "# 预算\n100").unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "# 预算\n100"
        );
        write_note(&directory, "预算.txt", "# 预算\n200").unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("预算.txt")).unwrap(),
            "# 预算\n200"
        );
        // 进出废纸篓
        move_note(&directory, "预算.txt", true).unwrap();
        assert!(directory.join(RECYCLED_DIR).join("预算.txt").exists());
        assert!(!directory.join("预算.txt").exists());
        move_note(&directory, "预算.txt", false).unwrap();
        assert!(directory.join("预算.txt").exists());
        // 目标同名冲突（recycled 里已有同名占位文件）
        fs::write(directory.join(RECYCLED_DIR).join("预算.txt"), "占位").unwrap();
        assert!(move_note(&directory, "预算.txt", true).is_err());
        fs::remove_file(directory.join(RECYCLED_DIR).join("预算.txt")).unwrap();
        // 运行时外部删除：ensure 重建同名空文件
        fs::remove_file(directory.join("预算.txt")).unwrap();
        assert!(ensure_note(&directory, "预算.txt").unwrap());
        assert_eq!(fs::read_to_string(directory.join("预算.txt")).unwrap(), "");
        assert!(!ensure_note(&directory, "预算.txt").unwrap());
        // 永久删除（recycled 内）
        move_note(&directory, "预算.txt", true).unwrap();
        delete_note(&directory, "recycled/预算.txt").unwrap();
        assert!(!directory.join(RECYCLED_DIR).join("预算.txt").exists());
        // 重载后的废纸篓 id 带 recycled/ 前缀：恢复必须落回数据目录
        write_note(&directory, "预算.txt", "# 预算\n1").unwrap();
        move_note(&directory, "预算.txt", true).unwrap();
        move_note(&directory, "recycled/预算.txt", false).unwrap();
        assert!(directory.join("预算.txt").exists());
        assert!(!directory.join(RECYCLED_DIR).join("预算.txt").exists());
        // 越界路径被拒绝
        assert!(resolve_note_path(&directory, "../escape.txt").is_err());
        assert!(resolve_note_path(&directory, "recycled/../escape.txt").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rename_note_follows_title_and_handles_conflicts() {
        let directory = temporary("rename");
        fs::create_dir_all(directory.join(RECYCLED_DIR)).unwrap();
        write_note(&directory, "预算.txt", "# 预算\n交通 = 186").unwrap();
        write_note(&directory, "交通.txt", "占位").unwrap();
        fs::write(directory.join(RECYCLED_DIR).join("旧.txt"), "# 旧的").unwrap();

        // 正常改名：文件更名、正文不动、id 返回新文件名
        let result = rename_note(&directory, "预算.txt", "周末出行").unwrap();
        assert_eq!(result.id, "周末出行.txt");
        assert_eq!(result.title, "周末出行");
        assert!(!directory.join("预算.txt").exists());
        assert_eq!(
            fs::read_to_string(directory.join("周末出行.txt")).unwrap(),
            "# 预算\n交通 = 186"
        );
        // 撞名自动加序号
        let result = rename_note(&directory, "周末出行.txt", "交通").unwrap();
        assert_eq!(result.id, "交通 2.txt");
        assert_eq!(result.title, "交通 2");
        // 同名改名是无操作（保留原 id）
        let result = rename_note(&directory, "交通 2.txt", "交通 2").unwrap();
        assert_eq!(result.id, "交通 2.txt");
        // 用户带上扩展名也会剥掉
        let result = rename_note(&directory, "交通 2.txt", "报销.TXT").unwrap();
        assert_eq!(result.id, "报销.txt");
        // 标题里的路径字符被替换，不越界
        let result = rename_note(&directory, "报销.txt", "a/b:c").unwrap();
        assert_eq!(result.id, "a-b-c.txt");
        // 废纸篓里的笔记改名留在原层级，id 带前缀
        let result = rename_note(&directory, "recycled/旧.txt", "归档").unwrap();
        assert_eq!(result.id, "recycled/归档.txt");
        assert!(!directory.join(RECYCLED_DIR).join("旧.txt").exists());
        assert!(directory.join(RECYCLED_DIR).join("归档.txt").exists());
        // 文件不存在时报错
        assert!(rename_note(&directory, "没有.txt", "随便").is_err());
        // 空标题退回兜底名
        let result = rename_note(&directory, "a-b-c.txt", "  ").unwrap();
        assert_eq!(result.id, "未命名.txt");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn create_note_keeps_filename_as_title_and_empty_body() {
        let directory = temporary("create");
        let note = create_note(&directory, "随手计算", "").unwrap();
        assert_eq!(note.id, "随手计算.txt");
        assert_eq!(note.title, "随手计算");
        assert_eq!(
            fs::read_to_string(directory.join("随手计算.txt")).unwrap(),
            ""
        );
        // 撞名加序号
        let second = create_note(&directory, "随手计算", "1 + 1").unwrap();
        assert_eq!(second.id, "随手计算 2.txt");
        assert_eq!(second.body, "1 + 1");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_workspace_migrates_into_files_and_recycled() {
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
                    "title": "废纸篓里的",
                    "body": "旧的",
                    "createdAt": "2026-09-06T00:00:00.000Z",
                    "updatedAt": "2026-09-06T00:00:00.000Z",
                    "trashed": true
                }
            ],
            "activeId": "note-1",
            "theme": "dark",
            "format": {
                "operatorSpace": true,
                "commentSpace": true,
                "unitStyle": "free",
                "unitSystem": "free"
            }
        });
        fs::write(
            directory.join(WORKSPACE_FILE),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();

        let payload = scan(&directory).unwrap();
        assert_eq!(payload.theme, "dark");
        assert_eq!(payload.notes.len(), 2);
        assert_eq!(payload.notes[0].id, "人体消耗计算.txt");
        assert_eq!(
            fs::read_to_string(directory.join("人体消耗计算.txt")).unwrap(),
            "# 人体消耗计算\nBMR = 1,566.25"
        );
        assert_eq!(payload.notes[1].id, "recycled/废纸篓里的.txt");
        assert!(directory.join(RECYCLED_DIR).join("废纸篓里的.txt").exists());
        // workspace.json 重写为只含设置，旧文件留了备份
        let meta = fs::read_to_string(directory.join(WORKSPACE_FILE)).unwrap();
        assert!(!meta.contains("BMR"));
        assert!(directory.join("workspace.json.bak").exists());
        // 迁移后再扫描稳定
        assert_eq!(scan(&directory).unwrap(), payload);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn settings_validation_drops_stale_active_note() {
        let directory = temporary("settings");
        write_note(&directory, "预算.txt", "# 预算").unwrap();
        save_settings(
            &directory,
            "dark",
            Some("预算.txt"),
            &FormatSettings::default(),
            DEFAULT_HISTORY_LIMIT_KB,
        )
        .unwrap();
        let payload = scan(&directory).unwrap();
        assert_eq!(payload.active_id.as_deref(), Some("预算.txt"));
        assert_eq!(payload.theme, "dark");
        // 主题非法被拒绝
        assert!(save_settings(
            &directory,
            "nope",
            None,
            &FormatSettings::default(),
            DEFAULT_HISTORY_LIMIT_KB
        )
        .is_err());
        // 当前笔记文件被外部删除后，保存设置时丢弃引用
        fs::remove_file(directory.join("预算.txt")).unwrap();
        save_settings(
            &directory,
            "light",
            Some("预算.txt"),
            &FormatSettings::default(),
            DEFAULT_HISTORY_LIMIT_KB,
        )
        .unwrap();
        let settings: WorkspaceSettings =
            serde_json::from_slice(&fs::read(directory.join(WORKSPACE_FILE)).unwrap()).unwrap();
        assert_eq!(settings.active_id, None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn history_records_compacts_caps_and_follows_rename_delete() {
        let directory = temporary("history");
        // 测试用历史上限：128 KB
        let test_limit: u64 = 128 * 1024;
        write_note(&directory, "预算.txt", "# 预算\n100").unwrap();

        // 当前小时内可以有多份（时分秒命名），列表最新在前
        record_history(
            &directory,
            "预算.txt",
            "第一版",
            "2026-09-30-14-00-30",
            test_limit,
        )
        .unwrap();
        record_history(
            &directory,
            "预算.txt",
            "第二版",
            "2026-09-30-14-30-00",
            test_limit,
        )
        .unwrap();
        let entries = list_history(&directory, "预算.txt", "2026-09-30-14").unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["2026-09-30-14-30-00", "2026-09-30-14-00-30"]
        );
        assert_eq!(entries[0].content, "第二版");
        // 废纸篓前缀不影响归属
        assert_eq!(
            list_history(&directory, "recycled/预算.txt", "2026-09-30-14")
                .unwrap()
                .len(),
            2
        );
        // 时间戳格式校验：缺秒、越界、非法名被拒绝
        assert!(record_history(&directory, "预算.txt", "x", "2026-09-30-14", test_limit).is_err());
        assert!(
            record_history(&directory, "预算.txt", "x", "../evil-00-00-00", test_limit).is_err()
        );
        assert!(
            record_history(&directory, "预算.txt", "x", "a/b-00-00-00-00", test_limit).is_err()
        );
        // 没有历史时列空表
        assert!(list_history(&directory, "没有.txt", "2026-09-30-14")
            .unwrap()
            .is_empty());

        // 留档更早的小时：该小时被整理为一份整点快照（留最后一份），当前小时不动
        record_history(
            &directory,
            "预算.txt",
            "上午一",
            "2026-09-30-09-01-00",
            test_limit,
        )
        .unwrap();
        record_history(
            &directory,
            "预算.txt",
            "上午二",
            "2026-09-30-09-59-00",
            test_limit,
        )
        .unwrap();
        // 旧版 13 字符整点文件在同一小时参与整理并迁移命名
        fs::write(
            directory
                .join("history")
                .join("预算")
                .join("2026-09-29-08.txt"),
            "旧版",
        )
        .unwrap();
        let entries = list_history(&directory, "预算.txt", "2026-09-30-09").unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        // 14 点已整理：只留整点命名的「第二版」
        assert!(names.contains(&"2026-09-30-14-00-00"));
        assert!(!names.contains(&"2026-09-30-14-30-00"));
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.name == "2026-09-30-14-00-00")
                .unwrap()
                .content,
            "第二版"
        );
        // 09 点是列表时的当前小时，多份保留
        assert!(names.contains(&"2026-09-30-09-01-00"));
        assert!(names.contains(&"2026-09-30-09-59-00"));
        // 旧版 08 点文件只有一份，无需整理，保留原名（列表兼容两种命名）
        assert!(names.contains(&"2026-09-29-08"));
        assert!(!names.contains(&"2026-09-29-08-00-00"));
        // 再晚一小时列出：09 点也整理为一份整点（留最后一份）
        let entries = list_history(&directory, "预算.txt", "2026-09-30-15").unwrap();
        let nine = entries
            .iter()
            .find(|entry| entry.name == "2026-09-30-09-00-00")
            .unwrap();
        assert_eq!(nine.content, "上午二");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(!names.contains(&"2026-09-30-09-01-00"));

        // 单篇 128KB 上限：超出后按时间桶从最早淘汰，最新一份永不淘汰
        let big = "x".repeat(40_000);
        for hour in 10..16 {
            record_history(
                &directory,
                "预算.txt",
                &big,
                &format!("2026-09-29-{hour:02}-00-00"),
                test_limit,
            )
            .unwrap();
        }
        let entries = list_history(&directory, "预算.txt", "2026-09-29-15").unwrap();
        let total: usize = entries.iter().map(|entry| entry.content.len()).sum();
        assert!(
            (total as u64) <= test_limit,
            "历史总量 {total} 应不超过 {test_limit}"
        );
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        for evicted in [
            "2026-09-29-10-00-00",
            "2026-09-29-11-00-00",
            "2026-09-29-12-00-00",
        ] {
            assert!(!names.contains(&evicted), "最早的历史 {evicted} 应被淘汰");
        }
        for kept in [
            "2026-09-29-13-00-00",
            "2026-09-29-14-00-00",
            "2026-09-29-15-00-00",
        ] {
            assert!(names.contains(&kept), "最近的历史 {kept} 应保留");
        }

        // 单份快照本身超过上限（超大笔记）：淘汰其余后保留最新一份，历史不全空
        create_note(&directory, "大部头", "").unwrap();
        let huge = "y".repeat(200_000);
        record_history(
            &directory,
            "大部头.txt",
            &huge,
            "2026-09-30-10-00-00",
            test_limit,
        )
        .unwrap();
        record_history(
            &directory,
            "大部头.txt",
            &huge,
            "2026-09-30-11-00-00",
            test_limit,
        )
        .unwrap();
        let entries = list_history(&directory, "大部头.txt", "2026-09-30-11").unwrap();
        assert_eq!(entries.len(), 1, "超大快照只保留最新一份");
        assert_eq!(entries[0].name, "2026-09-30-11-00-00");

        // 删除单条历史：秒级与旧整点名都可删，空目录一并清理；非法名拒绝
        delete_history(&directory, "预算.txt", "2026-09-30-14-30-00").unwrap();
        let entries = list_history(&directory, "预算.txt", "2026-09-30-14").unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(!names.contains(&"2026-09-30-14-30-00"));
        assert!(names.contains(&"2026-09-30-09-00-00"));
        assert!(delete_history(&directory, "预算.txt", "not-a-time").is_err());
        assert!(delete_history(&directory, "预算.txt", "2026-09-30-14-30-00").is_ok());
        // 历史关闭（上限 0）：留档调用清空该笔记的既有历史，不写入新快照
        record_history(&directory, "大部头.txt", &huge, "2026-09-30-12-00-00", 0).unwrap();
        assert!(!directory.join("history").join("大部头").exists());

        // 改名：历史目录跟随
        rename_note(&directory, "预算.txt", "出行").unwrap();
        assert!(!directory.join("history").join("预算").exists());
        assert!(!list_history(&directory, "出行.txt", "2026-09-29-15")
            .unwrap()
            .is_empty());
        // 永久删除：历史目录一并清理
        delete_note(&directory, "出行.txt").unwrap();
        assert!(!directory.join("history").join("出行").exists());
        // 大部头也清掉，避免干扰后面的启动清理断言
        delete_note(&directory, "大部头.txt").unwrap();
        // 启动清理：scan 删除没有对应笔记的孤儿历史目录，废纸篓笔记的保留
        write_note(&directory, "预算.txt", "# 预算\n1").unwrap();
        record_history(
            &directory,
            "预算.txt",
            "有历史",
            "2026-09-30-12-00-00",
            test_limit,
        )
        .unwrap();
        fs::create_dir_all(directory.join("history").join("孤儿")).unwrap();
        move_note(&directory, "预算.txt", true).unwrap();
        let payload = scan(&directory).unwrap();
        assert!(directory.join("history").join("预算").exists());
        assert!(!directory.join("history").join("孤儿").exists());
        assert_eq!(payload.notes.len(), 1);
        assert!(
            !list_history(&directory, "recycled/预算.txt", "2026-09-30-12")
                .unwrap()
                .is_empty()
        );
        // 设置为 0（关闭历史）：启动扫描清空全部历史目录
        fs::create_dir_all(directory.join("history").join("预算")).unwrap();
        fs::write(
            directory
                .join("history")
                .join("预算")
                .join("2026-09-30-13-00-00.txt"),
            "重启前的历史",
        )
        .unwrap();
        save_settings(&directory, "light", None, &FormatSettings::default(), 0).unwrap();
        scan(&directory).unwrap();
        assert!(!directory.join("history").exists());
        fs::remove_dir_all(directory).unwrap();
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
    fn relocate_refuses_occupied_target_and_copies_everything() {
        let root = temporary("relocate");
        let current = root.join("current");
        let target = root.join("target");
        fs::create_dir_all(current.join(RECYCLED_DIR)).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(current.join("a.txt"), "# A").unwrap();
        fs::write(current.join(RECYCLED_DIR).join("b.txt"), "# B").unwrap();
        save_settings(
            &current,
            "light",
            None,
            &FormatSettings::default(),
            DEFAULT_HISTORY_LIMIT_KB,
        )
        .unwrap();

        let store = Store {
            config: root.join("config"),
            default: current.clone(),
            legacy: None,
        };
        // 目标已有 .txt：拒绝
        fs::write(target.join("占位.txt"), "x").unwrap();
        assert!(store.relocate(&target).is_err());
        fs::remove_file(target.join("占位.txt")).unwrap();
        store.relocate(&target).unwrap();
        assert_eq!(
            store.directory().unwrap(),
            fs::canonicalize(&target).unwrap()
        );
        assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "# A");
        assert_eq!(
            fs::read_to_string(target.join(RECYCLED_DIR).join("b.txt")).unwrap(),
            "# B"
        );
        assert!(target.join(WORKSPACE_FILE).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
