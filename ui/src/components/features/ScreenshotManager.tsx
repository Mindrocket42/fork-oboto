import React, { useEffect } from 'react';
import html2canvas from 'html2canvas';
import { wsService } from '../../services/wsService';

/**
 * CSS Color Level 4 function pattern.
 * html2canvas v1.x can't parse: color(), oklch(), oklab(), lab(), lch(), color-mix().
 */
const UNSUPPORTED_COLOR_RE = /\b(color|oklch|oklab|lab|lch|color-mix)\s*\(/i;

/** Color-related CSS properties that html2canvas tries to parse */
const COLOR_PROPS = [
    'color', 'background-color', 'border-color',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow',
    'caret-color', 'column-rule-color', 'fill', 'stroke',
];

/**
 * Sanitize CSS color values that html2canvas cannot parse.
 * Runs on the cloned DOM inside html2canvas's iframe BEFORE it parses styles.
 *
 * Strategy:
 *  1. Replace unsupported color functions in `<style>` text content
 *  2. Override computed styles inline so html2canvas's getComputedStyle reads safe values
 */
function sanitizeUnsupportedColors(doc: Document, root: HTMLElement) {
    // 1. Sanitize <style> tags in the cloned document
    const styles = doc.querySelectorAll('style');
    for (const style of Array.from(styles)) {
        if (style.textContent && UNSUPPORTED_COLOR_RE.test(style.textContent)) {
            // Replace unsupported color functions with transparent/currentColor
            style.textContent = style.textContent.replace(
                /\b(color|oklch|oklab|lab|lch|color-mix)\s*\([^)]*(?:\([^)]*\)[^)]*)*\)/gi,
                'transparent'
            );
        }
    }

    // 2. Walk all elements and override computed styles with safe inline values
    const getCS = doc.defaultView?.getComputedStyle;
    if (!getCS) return;

    const allElements = root.querySelectorAll('*');
    const elementsArray = [root, ...Array.from(allElements)] as HTMLElement[];

    for (const el of elementsArray) {
        if (!el.style) continue;
        try {
            const cs = getCS.call(doc.defaultView, el);
            for (const prop of COLOR_PROPS) {
                const val = cs.getPropertyValue(prop);
                if (val && UNSUPPORTED_COLOR_RE.test(val)) {
                    const fallback = prop === 'color' || prop === 'caret-color'
                        ? 'inherit'
                        : 'transparent';
                    el.style.setProperty(prop, fallback);
                }
            }
        } catch {
            // getComputedStyle can fail on detached or pseudo elements — skip
        }
    }
}

export const ScreenshotManager: React.FC = () => {
  useEffect(() => {
    const unsub = wsService.on('request-screenshot', async (payload: unknown) => {
        const { requestId, surfaceId } = payload as { requestId: string; surfaceId: string };
        console.log(`[ScreenshotManager] Received request for surface: ${surfaceId} (req: ${requestId})`);

        try {
            const element = document.getElementById(`surface-${surfaceId}`);
            if (!element) {
                console.error(`[ScreenshotManager] Element not found: #surface-${surfaceId}`);
                wsService.sendMessage('screenshot-captured', {
                    requestId,
                    error: `Surface element #${surfaceId} not found in DOM`
                });
                return;
            }

            // Capture the element
            // useCORS: true is often needed for external images, though surfaces are mostly local
            // logging: false to reduce noise
            // onclone: sanitize CSS Color Level 4 functions that html2canvas can't parse
            const canvas = await html2canvas(element, {
                useCORS: true,
                logging: false,
                backgroundColor: '#080808', // Match theme background
                onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
                    sanitizeUnsupportedColors(clonedDoc, clonedEl);
                }
            });

            const image = canvas.toDataURL('image/jpeg', 0.8);
            
            wsService.sendMessage('screenshot-captured', {
                requestId,
                image
            });
            console.log(`[ScreenshotManager] Screenshot sent for surface: ${surfaceId}`);

        } catch (error) {
            console.error('[ScreenshotManager] Capture failed:', error);
            wsService.sendMessage('screenshot-captured', {
                requestId,
                error: `Capture failed: ${(error as Error).message}`
            });
        }
    });

    return () => {
        unsub();
    };
  }, []);

  return null; // Headless component
};
