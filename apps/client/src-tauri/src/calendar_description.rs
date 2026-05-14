use std::collections::{HashMap, HashSet};

use ammonia::{Builder, UrlRelative};

const ALLOWED_TAGS: [&str; 12] = [
    "a", "b", "br", "div", "em", "i", "li", "ol", "p", "strong", "u", "ul",
];

const CLEAN_CONTENT_TAGS: [&str; 10] = [
    "base", "embed", "iframe", "link", "math", "meta", "object", "script", "style", "svg",
];

/// Sanitize calendar description HTML using the same rich-text subset as the
/// frontend editor.
pub fn sanitize_calendar_description_html(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    calendar_description_builder().clean(value).to_string()
}

pub fn sanitize_optional_calendar_description(value: &Option<String>) -> Option<String> {
    value.as_deref().map(sanitize_calendar_description_html)
}

fn calendar_description_builder() -> Builder<'static> {
    let mut tag_attributes = HashMap::new();
    tag_attributes.insert("a", HashSet::from(["href"]));

    let mut builder = Builder::empty();
    builder
        .tags(HashSet::from(ALLOWED_TAGS))
        .tag_attributes(tag_attributes)
        .generic_attributes(HashSet::new())
        .generic_attribute_prefixes(HashSet::new())
        .url_schemes(HashSet::from(["http", "https"]))
        .url_relative(UrlRelative::Deny)
        .link_rel(None)
        .clean_content_tags(HashSet::from(CLEAN_CONTENT_TAGS))
        .strip_comments(true);
    builder
}

#[cfg(test)]
mod tests {
    use super::sanitize_calendar_description_html;

    #[test]
    fn keeps_allowed_formatting_and_http_links() {
        let html = [
            "<p><strong>Strong</strong> <b>bold</b></p>",
            "<div><em>Em</em> <i>italic</i> <u>underline</u><br></div>",
            "<ol><li>One</li></ol><ul><li>Two</li></ul>",
            "<a href=\"https://example.com/path\">Link</a>",
            "<a href=\"http://example.com\">Http</a>",
        ]
        .join("");

        assert_eq!(sanitize_calendar_description_html(&html), html);
    }

    #[test]
    fn removes_unsafe_tags_attributes_styles_and_url_schemes() {
        let html = [
            "<script>alert('x')</script>",
            "<img src=\"x\" onerror=\"alert(1)\">",
            "<svg><circle onload=\"alert(1)\"></circle></svg>",
            "<iframe src=\"https://example.com\"></iframe>",
            "<form action=\"https://example.com\"><input value=\"x\"></form>",
            "<p style=\"color:red\" onclick=\"alert(1)\">Text ",
            "<a href=\"javascript:alert(1)\" onclick=\"alert(1)\">bad</a>",
            "<a href=\"https://safe.example\" target=\"_blank\" rel=\"noopener\">safe</a>",
            "</p>",
        ]
        .join("");

        let sanitized = sanitize_calendar_description_html(&html);

        assert!(!sanitized.contains("script"));
        assert!(!sanitized.contains("img"));
        assert!(!sanitized.contains("svg"));
        assert!(!sanitized.contains("iframe"));
        assert!(!sanitized.contains("form"));
        assert!(!sanitized.contains("style="));
        assert!(!sanitized.contains("onclick"));
        assert!(!sanitized.contains("javascript:"));
        assert!(sanitized.contains("<p>Text <a>bad</a>"));
        assert!(sanitized.contains("<a href=\"https://safe.example\">safe</a>"));
    }

    #[test]
    fn turns_pasted_rich_html_into_safe_output() {
        let html = [
            "<span style=\"font-size:48px\" onclick=\"alert(1)\">",
            "<b>Keep bold</b>",
            "</span>",
            "<div><font color=\"red\">Plain text</font>",
            "<a href=\"ftp://example.com/file\">ftp link</a></div>",
        ]
        .join("");

        assert_eq!(
            sanitize_calendar_description_html(&html),
            "<b>Keep bold</b><div>Plain text<a>ftp link</a></div>",
        );
    }

    #[test]
    fn removes_script_and_style_content() {
        let sanitized = sanitize_calendar_description_html(
            "<p>Safe</p><script>alert(1)</script><style>body{display:none}</style>",
        );

        assert_eq!(sanitized, "<p>Safe</p>");
    }
}
