#!/usr/bin/env node

import { inspect } from "node:util";
import process from "node:process";

process.env.NODE_ENV ??= 'test';

const { CFG, saveConfig } = await import("../src/config.js");

const HELP_MESSAGE = `Usage: config-cli <command> [arguments]\n\nCommands:\n  list                 Print the merged configuration as JSON.\n  get <path>           Read a configuration value using dot notation.\n  set <path> <value>   Persist a configuration value using dot notation.\n\nExamples:\n  config-cli list\n  config-cli get indicators.macd.fast\n  config-cli set alerts.modules.rsi true\n  config-cli set accountEquity 12500\n`;

const [,, rawCommand, ...rawArgs] = process.argv;

if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    process.stdout.write(HELP_MESSAGE);
    process.exit(rawCommand ? 0 : 1);
}

const command = rawCommand.toLowerCase();

function getValueAtPath(target, path) {
    const parts = path.split('.').filter(Boolean);
    let current = target;
    for (const part of parts) {
        if (current == null) {
            return undefined;
        }
        const key = Number.isInteger(Number(part)) && part.trim() !== '' ? Number(part) : part;
        current = current[key];
    }
    return current;
}

function buildPartialConfig(path, value) {
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) {
        throw new Error('A configuration path is required.');
    }
    return parts.reduceRight((acc, key) => ({ [key]: acc }), value);
}

function parseValue(raw) {
    if (raw === undefined) {
        throw new Error('Missing value for set command.');
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        if (!Number.isNaN(Number(raw))) {
            return Number(raw);
        }
        return raw;
    }
}

async function run() {
    switch (command) {
    case 'list': {
        const json = JSON.stringify(CFG, null, 4);
        process.stdout.write(`${json}\n`);
        return 0;
    }
    case 'get': {
        const [path] = rawArgs;
        if (!path) {
            throw new Error('Missing configuration path for get command.');
        }
        const value = getValueAtPath(CFG, path);
        if (value === undefined) {
            process.stderr.write(`No value found at path: ${path}\n`);
            return 1;
        }
        if (typeof value === 'string') {
            process.stdout.write(`${value}\n`);
        } else {
            process.stdout.write(`${inspect(value, { depth: Infinity, colors: false })}\n`);
        }
        return 0;
    }
    case 'set': {
        const [path, rawValue] = rawArgs;
        if (!path) {
            throw new Error('Missing configuration path for set command.');
        }
        const value = parseValue(rawValue);
        const partial = buildPartialConfig(path, value);
        await saveConfig(partial);
        process.stdout.write(`Updated ${path} to ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
        return 0;
    }
    default:
        process.stderr.write(`Unknown command: ${command}\n`);
        process.stderr.write(HELP_MESSAGE);
        return 1;
    }
}

run()
    .then((code) => {
        process.exit(code ?? process.exitCode ?? 0);
    })
    .catch((error) => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exit(1);
    });
