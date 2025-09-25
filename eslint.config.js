import js from "@eslint/js";
import globals from "globals";

const loggingMethods = new Set(["debug", "info", "warn", "error", "trace"]);

const stylePlugin = {
    rules: {
        "import-double-quotes": {
            meta: {
                type: "layout",
                docs: {
                    description: "Garante aspas duplas em imports para seguir a convenção do projeto.",
                },
                fixable: "code",
                schema: [],
                messages: {
                    expected: "Use aspas duplas nas declarações de import.",
                },
            },
            create(context) {
                return {
                    ImportDeclaration(node) {
                        const source = node.source;
                        if (!source || source.type !== "Literal" || typeof source.value !== "string") {
                            return;
                        }
                        const raw = context.sourceCode.getText(source);
                        if (!raw.startsWith("\"")) {
                            context.report({
                                node: source,
                                messageId: "expected",
                                fix(fixer) {
                                    const escaped = source.value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
                                    return fixer.replaceText(source, `"${escaped}"`);
                                },
                            });
                        }
                    },
                };
            },
        },
        "log-single-quotes": {
            meta: {
                type: "layout",
                docs: {
                    description: "Garante aspas simples em mensagens de log para manter consistência com o logger.",
                },
                fixable: "code",
                schema: [],
                messages: {
                    expected: "Use aspas simples nas mensagens enviadas ao logger.",
                },
            },
            create(context) {
                const sourceCode = context.sourceCode;
                return {
                    CallExpression(node) {
                        const callee = node.callee;
                        if (!callee || callee.type !== "MemberExpression") {
                            return;
                        }
                        const property = callee.property;
                        if (!property || property.type !== "Identifier" || !loggingMethods.has(property.name)) {
                            return;
                        }
                        for (const arg of node.arguments) {
                            if (arg.type !== "Literal" || typeof arg.value !== "string") {
                                continue;
                            }
                            const raw = sourceCode.getText(arg);
                            if (!raw.startsWith("'")) {
                                const escaped = arg.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                                context.report({
                                    node: arg,
                                    messageId: "expected",
                                    fix(fixer) {
                                        return fixer.replaceText(arg, `'${escaped}'`);
                                    },
                                });
                            }
                        }
                    },
                };
            },
        },
    },
};

const baseGlobals = {
    ...globals.node,
    ...globals.es2021,
};

export default [
    {
        ignores: [
            "**/node_modules/**",
            "coverage/**",
            "charts/**",
            "reports/**",
            "docs/**",
            "website/**",
        ],
    },
    {
        files: [
            "eslint.config.js",
            "tests/ai.test.js",
            "tests/data/**/*.js",
            "src/data/**/*.js",
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: baseGlobals,
        },
        plugins: {
            style: stylePlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            indent: ["error", 4, { SwitchCase: 1 }],
            "no-var": "error",
            "prefer-const": ["error", { destructuring: "all" }],
            semi: ["error", "always"],
            "style/import-double-quotes": "error",
            "style/log-single-quotes": "error",
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...baseGlobals,
                vi: true,
                describe: true,
                it: true,
                expect: true,
                beforeEach: true,
                afterEach: true,
            },
        },
        rules: {
            "no-unused-expressions": "off",
        },
    },
];
