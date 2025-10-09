import React from "react";

export default function ChartPreview({ src, alt }) {
    if (!src) {
        return <div className="chart-placeholder">No chart available</div>;
    }
    return <img className="chart-preview" src={src} alt={alt} loading="lazy" />;
}
