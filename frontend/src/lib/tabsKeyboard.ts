/** Teclado de `role="tablist"` (WAI-ARIA): setas dão a volta, Home/End vão às pontas. */
export function nextTabIndex(key: string, current: number, total: number): number | null {
    switch (key) {
        case 'ArrowRight':
            return (current + 1) % total;
        case 'ArrowLeft':
            return (current - 1 + total) % total;
        case 'Home':
            return 0;
        case 'End':
            return total - 1;
        default:
            return null;
    }
}
