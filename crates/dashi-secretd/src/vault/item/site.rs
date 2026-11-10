//! A site as a login names it, and which pages it belongs on.

/// A site as typed ("https://GitHub.com/login") to the host it names
/// ("github.com"); None for anything that is not a plain host name.
pub fn normalize_site(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let rest = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = host.split(':').next()?.trim_end_matches('.');
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let valid = !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    valid.then_some(host)
}

/// Whether a login for `site` belongs on a page at `host`: the same host, or one under it.
pub fn site_matches(site: &str, host: &str) -> bool {
    let Some(host) = normalize_site(host) else {
        return false;
    };
    host == site || host.ends_with(&format!(".{site}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_are_plain_host_names() {
        assert_eq!(
            normalize_site("https://GitHub.com/login?x=1").as_deref(),
            Some("github.com")
        );
        assert_eq!(normalize_site("www.ynab.com").as_deref(), Some("ynab.com"));
        assert_eq!(
            normalize_site("user@bank.example:8443/").as_deref(),
            Some("bank.example")
        );
        assert_eq!(normalize_site("localhost"), None);
        assert_eq!(normalize_site("evil .com"), None);
        assert_eq!(normalize_site(""), None);
    }

    #[test]
    fn a_login_matches_its_host_and_subdomains_only() {
        assert!(site_matches("github.com", "github.com"));
        assert!(site_matches("github.com", "https://gist.github.com/x"));
        assert!(!site_matches("github.com", "github.com.evil.example"));
        assert!(!site_matches("github.com", "evilgithub.com"));
        assert!(!site_matches("github.com", "not a host"));
    }
}
