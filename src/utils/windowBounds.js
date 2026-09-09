function clampBoundsToWorkArea(bounds, workArea) {
    const width = Math.min(Math.max(320, Math.round(bounds.width)), workArea.width);
    const height = Math.min(Math.max(240, Math.round(bounds.height)), workArea.height);
    return {
        x: Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width),
        y: Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height),
        width,
        height,
    };
}

module.exports = { clampBoundsToWorkArea };
