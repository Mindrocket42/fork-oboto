/**
 * @file Shared markdown sanitization for __directMarkdown plugin outputs.
 * @module src/lib/sanitize-markdown
 *
 * Strips dangerous HTML tags and event-handler attributes from plugin-injected
 * markdown to prevent XSS / UI spoofing.  Markdown renderers handle rendering;
 * raw <script>, <iframe>, <style>, <img onerror>, etc. are never legitimate
 * in plugin-injected markdown.
 *
 * Used by both {@link ToolExecutor} and {@link EventicAgentLoopPlugin} to
 * ensure consistent sanitization regardless of the execution path.
 */

/**
 * Sanitize a raw markdown string by removing dangerous HTML constructs.
 *
 * @param {string} rawMarkdown — The unsanitized markdown string
 * @returns {string} Sanitized markdown safe for rendering
 */
export function sanitizeDirectMarkdown(rawMarkdown) {
    let sanitized = String(rawMarkdown);

    // Strip dangerous HTML tags (opening and closing variants)
    sanitized = sanitized.replace(
        /<\/?(?:script|iframe|object|embed|form|input|button|textarea|select|style|link|meta|base|applet)[^>]*>/gi,
        ''
    );

    // Strip event handler attributes from any remaining tags
    // e.g. <img onerror="alert(1)"> → <img>
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

    return sanitized;
}
