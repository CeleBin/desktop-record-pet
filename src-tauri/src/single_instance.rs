pub const SECOND_INSTANCE_EVENT: &str = "app:second-instance";

pub fn second_instance_notice() -> (&'static str, &'static str) {
    ("Desktop Record Pet", "程序已经在运行，已激活主窗口。")
}

#[cfg(test)]
mod tests {
    use super::{second_instance_notice, SECOND_INSTANCE_EVENT};

    #[test]
    fn second_instance_event_name_is_stable() {
        assert_eq!(SECOND_INSTANCE_EVENT, "app:second-instance");
    }

    #[test]
    fn second_instance_notice_is_non_empty() {
        let (title, message) = second_instance_notice();

        assert!(!title.is_empty());
        assert!(!message.is_empty());
    }
}
