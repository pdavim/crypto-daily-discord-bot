import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { promises as fs } from "node:fs/promises";
import path from "node:path";

const WIDTH = 1280;
const HEIGHT = 720;

const chartModule = await import("chart.js/auto");
const Chart = chartModule.Chart ?? chartModule.default ?? chartModule;

const canvas = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    chartJs: Chart,
});

function buildDataset(values) {
    return values.map((value) => {
        if (!Number.isFinite(value)) {
            return {
                backgroundColor: 'rgba(189, 195, 199, 0.7)',
                borderColor: 'rgba(189, 195, 199, 1)',
            };
        }
        if (value >= 0) {
            return {
                backgroundColor: 'rgba(46, 204, 113, 0.7)',
                borderColor: 'rgba(39, 174, 96, 1)',
            };
        }
        return {
            backgroundColor: 'rgba(231, 76, 60, 0.7)',
            borderColor: 'rgba(192, 57, 43, 1)',
        };
    });
}

/**
 * Generates a monthly performance bar chart and saves it to disk.
 * @param {Object} params - Chart configuration.
 * @param {string} params.monthKey - Month identifier used in the chart title.
 * @param {Array<string>} params.labels - Asset labels.
 * @param {Array<number>} params.values - Average performance values per asset.
 * @returns {Promise} Absolute path to the rendered PNG file.
 */
export async function renderMonthlyPerformanceChart({ monthKey, labels, values }) {
    if (!Array.isArray(labels) || !Array.isArray(values) || labels.length !== values.length) {
        throw new Error('Labels and values must be arrays of the same length.');
    }

    const colours = buildDataset(values);
    const data = {
        labels,
        datasets: [
            {
                label: `Variação média semanal (${monthKey})`,
                data: values.map((value) => Number.isFinite(value) ? Number.parseFloat(value.toFixed(2)) : 0),
                backgroundColor: colours.map((c) => c.backgroundColor),
                borderColor: colours.map((c) => c.borderColor),
                borderWidth: 1,
            },
        ],
    };

    const options = {
        responsive: false,
        plugins: {
            title: {
                display: true,
                text: `Performance média semanal - ${monthKey}`,
            },
            legend: { display: true },
            tooltip: {
                callbacks: {
                    label(context) {
                        const value = Number(context.parsed.y ?? 0);
                        return `${context.dataset.label}: ${value.toFixed(2)}%`;
                    },
                },
            },
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback(value) {
                        const numeric = Number(value ?? 0);
                        return `${numeric.toFixed(0)}%`;
                    },
                },
            },
        },
    };

    const configuration = {
        type: 'bar',
        data,
        options,
    };

    const buffer = await canvas.renderToBuffer(configuration);
    const dir = path.resolve('reports');
    await fs.mkdir(dir, { recursive: true });
    const filename = `monthly-performance-${monthKey}.png`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buffer);
    return filePath;
}
