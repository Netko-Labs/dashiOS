//! The hosts a token is for: how they are written, listed and matched.

const MAX_HOSTS: usize = 32;

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// A host as typed ("https://API.GitHub.com/v3") to the name it lists
/// ("api.github.com"); "*.example.com" lists every host under example.com
/// (not example.com itself). None for anything else.
pub fn normalize_host(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let rest = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = host.split(':').next()?.trim_end_matches('.');
    let host = host.to_ascii_lowercase();
    let (wild, name) = match host.strip_prefix("*.") {
        Some(name) => (true, name),
        None => (false, host.as_str()),
    };
    let labels: Vec<&str> = name.split('.').collect();
    let valid = name.len() <= 253 && labels.len() >= 2 && labels.iter().all(|l| valid_label(l));
    valid.then(|| {
        if wild {
            format!("*.{name}")
        } else {
            name.into()
        }
    })
}

/// Whether a request to `host` may carry a token listed for `hosts`: the
/// same host, or one under a "*." entry. Nothing else: not a parent, not a
/// look-alike, not an address that merely ends the same.
pub fn host_listed(hosts: &[String], host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalize_host(&host).as_deref() != Some(host.as_str()) || host.starts_with("*.") {
        return false;
    }
    hosts.iter().any(|listed| match listed.strip_prefix("*.") {
        Some(suffix) => host.ends_with(&format!(".{suffix}")),
        None => *listed == host,
    })
}

/// The hosts an item names, each normalized, without repeats: 1 to MAX_HOSTS.
pub(super) fn hosts_of(input: &[String]) -> Result<Vec<String>, String> {
    let mut hosts = Vec::new();
    for entry in input {
        let host = normalize_host(entry).ok_or_else(|| format!("“{entry}” is not a host name"))?;
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    if hosts.is_empty() || hosts.len() > MAX_HOSTS {
        return Err(format!("a token is for 1 to {MAX_HOSTS} hosts"));
    }
    Ok(hosts)
}
