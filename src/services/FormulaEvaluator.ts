/**
 * Safe, zero-LLM spreadsheet-style formula evaluator for custom calculated health metrics.
 * Supports standard arithmetic operations (+, -, *, /, ^, %), parentheses, and variable substitutions.
 */

export type LookbackProvider = (key: string, days: number) => number[];

export class FormulaEvaluator {
    /**
     * Extracts variable identifiers used inside a formula string.
     * e.g. "(protein * 4) + (carbs * 4) + (fat * 9)" -> ["protein", "carbs", "fat"]
     */
    public static extractVariables(formula: string): string[] {
        if (!formula || !formula.trim()) return [];
        const matches = formula.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
        // Filter out any math function names or reserved words
        const reserved = new Set([
            "min", "max", "round", "abs", "floor", "ceil", "sqrt",
            "rolling_max", "max_lookback", "rolling_min", "min_lookback",
            "rolling_avg", "avg_lookback", "rolling_sum", "sum_lookback"
        ]);
        return Array.from(new Set(matches.filter(m => !reserved.has(m.toLowerCase()))));
    }

    /**
     * Validates if a formula string is syntactically valid.
     */
    public static validateFormula(formula: string): { valid: boolean; error?: string; variables: string[] } {
        if (!formula || !formula.trim()) {
            return { valid: false, error: "Formula cannot be empty", variables: [] };
        }

        const variables = this.extractVariables(formula);

        // Dummy mock context with 1s to test syntax
        const dummyContext: Record<string, number> = {};
        variables.forEach(v => { dummyContext[v] = 1; });

        try {
            const res = this.evaluate(formula, dummyContext);
            if (res === null || isNaN(res) || !isFinite(res)) {
                return { valid: false, error: "Formula produced an invalid result (e.g. division by zero)", variables };
            }
            return { valid: true, variables };
        } catch (e: any) {
            return { valid: false, error: e.message || "Syntax error in formula", variables };
        }
    }

    /**
     * Evaluates a mathematical formula given a dictionary of daily metric values.
     * Supports standard arithmetic (+, -, *, /, ^, %), rolling lookbacks, and math functions.
     * Returns null if any required variable is missing or if division by zero occurs.
     */
    public static evaluate(
        formula: string,
        context: Record<string, any>,
        lookbackProvider?: LookbackProvider
    ): number | null {
        if (!formula || !formula.trim()) return null;

        let expression = formula;

        // 1. Preprocess rolling window lookback functions: e.g. rolling_max(jar, 45)
        const rollingRegex = /(rolling_max|max_lookback|rolling_min|min_lookback|rolling_avg|avg_lookback|rolling_sum|sum_lookback)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*,\s*(\d+)\s*\)/gi;
        let rollingMatch;
        while ((rollingMatch = rollingRegex.exec(expression)) !== null) {
            const fullMatch = rollingMatch[0];
            const fn = rollingMatch[1].toLowerCase();
            const varName = rollingMatch[2];
            const days = parseInt(rollingMatch[3], 10);

            let history: number[] = [];
            if (lookbackProvider) {
                history = lookbackProvider(varName, days);
            } else if (context[varName] !== undefined && context[varName] !== null && context[varName] !== "") {
                const parsed = typeof context[varName] === "number" ? context[varName] : parseFloat(String(context[varName]).replace(/[^0-9.-]/g, ""));
                if (!isNaN(parsed)) history = [parsed];
            }

            let computedVal: number | null = null;
            if (history.length > 0) {
                if (fn === "rolling_max" || fn === "max_lookback") {
                    computedVal = Math.max(...history);
                } else if (fn === "rolling_min" || fn === "min_lookback") {
                    computedVal = Math.min(...history);
                } else if (fn === "rolling_avg" || fn === "avg_lookback") {
                    computedVal = history.reduce((a, b) => a + b, 0) / history.length;
                } else if (fn === "rolling_sum" || fn === "sum_lookback") {
                    computedVal = history.reduce((a, b) => a + b, 0);
                }
            } else if (!lookbackProvider) {
                // When validating syntax without historical database context
                computedVal = 1;
            }

            if (computedVal === null || isNaN(computedVal)) return null;
            expression = expression.replace(fullMatch, `(${computedVal})`);
            // Reset regex pointer
            rollingRegex.lastIndex = 0;
        }

        // 2. Check and replace each variable with its numeric value
        const variables = this.extractVariables(expression);
        for (const varName of variables) {
            let val = context[varName];

            // Case-insensitive fallback
            if (val === undefined || val === null || val === "") {
                for (const k in context) {
                    if (k.toLowerCase() === varName.toLowerCase()) {
                        val = context[k];
                        break;
                    }
                }
            }

            if (val === "") {
                val = 0;
            }

            if (val === undefined || val === null) {
                // If an odometer or cumulative meter variable is missing, do not default to 0 (which produces false spikes)
                if (varName.toLowerCase().includes("odometer") || varName.toLowerCase().includes("meter")) {
                    return null;
                }
                // Optional / absent numeric fields (e.g. alcohol, alcohol_prev, last_sleep) default to 0
                if (varName.toLowerCase().includes("alcohol") || varName.toLowerCase().includes("caff") || varName.toLowerCase().includes("workout") || varName.toLowerCase().endsWith("_prev") || varName.toLowerCase().endsWith("_yesterday") || varName.toLowerCase().startsWith("last_")) {
                    val = 0;
                } else {
                    return null;
                }
            }

            let num: number;
            if (typeof val === "number") {
                num = val;
            } else if (typeof val === "string" && val.includes(":") && !val.includes(" ")) {
                // Parse "HH:MM" into decimal hours e.g. "7:30" -> 7.5
                const parts = val.split(":");
                const h = parseFloat(parts[0]);
                const m = parseFloat(parts[1]);
                if (!isNaN(h) && !isNaN(m)) {
                    num = h + (m / 60);
                } else {
                    num = parseFloat(val.replace(/[^0-9.-]/g, ""));
                }
            } else {
                num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
            }

            if (isNaN(num)) return null;

            // Replace full variable token using regex word boundaries
            const regex = new RegExp(`\\b${varName}\\b`, "g");
            expression = expression.replace(regex, `(${num})`);
        }

        // 3. Resolve standard math functions inside-out: max, min, round, abs, floor, ceil, sqrt
        const resolved = this.resolveMathFunctions(expression);
        if (resolved === null) return null;
        expression = resolved;

        // 4. Tokenize and evaluate arithmetic using Shunting-yard algorithm
        try {
            return this.evaluateArithmetic(expression);
        } catch (e) {
            return null;
        }
    }

    private static splitFunctionArgs(str: string): string[] {
        const args: string[] = [];
        let cur = "";
        let depth = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (c === "(") depth++;
            else if (c === ")") depth--;
            else if (c === "," && depth === 0) {
                args.push(cur.trim());
                cur = "";
                continue;
            }
            cur += c;
        }
        if (cur.trim()) args.push(cur.trim());
        return args;
    }

    private static resolveMathFunctions(expr: string): string | null {
        const funcPattern = /\b(max|min|round|abs|floor|ceil|sqrt)\s*\(/i;
        let match;
        let iterations = 30;
        while ((match = funcPattern.exec(expr)) !== null && iterations-- > 0) {
            const fnName = match[1].toLowerCase();
            const startParen = match.index + match[0].length - 1;
            let depth = 1;
            let endParen = -1;
            for (let i = startParen + 1; i < expr.length; i++) {
                if (expr[i] === "(") depth++;
                else if (expr[i] === ")") {
                    depth--;
                    if (depth === 0) {
                        endParen = i;
                        break;
                    }
                }
            }
            if (endParen === -1) return null;

            const argsStr = expr.substring(startParen + 1, endParen);
            const rawArgs = this.splitFunctionArgs(argsStr);
            const args: number[] = [];
            for (const raw of rawArgs) {
                const resolvedArg = this.resolveMathFunctions(raw);
                if (resolvedArg === null) return null;
                const val = this.evaluateArithmetic(resolvedArg);
                if (val === null || isNaN(val)) return null;
                args.push(val);
            }

            let res: number | null = null;
            switch (fnName) {
                case "max": res = Math.max(...args); break;
                case "min": res = Math.min(...args); break;
                case "round":
                    res = args.length > 1 ? Math.round(args[0] * Math.pow(10, args[1])) / Math.pow(10, args[1]) : Math.round(args[0]);
                    break;
                case "abs": res = Math.abs(args[0]); break;
                case "floor": res = Math.floor(args[0]); break;
                case "ceil": res = Math.ceil(args[0]); break;
                case "sqrt": res = Math.sqrt(args[0]); break;
            }
            if (res === null || isNaN(res)) return null;

            expr = expr.substring(0, match.index) + "(" + res + ")" + expr.substring(endParen + 1);
        }
        return expr;
    }

    /**
     * Safe arithmetic parser implementing Shunting-Yard algorithm (No eval / No Function).
     */
    private static evaluateArithmetic(expr: string): number | null {
        // Replace power operator
        expr = expr.replace(/\^/g, " ** ");

        // Tokenize numbers, operators, and parentheses
        const tokens: string[] = [];
        const regex = /\d+(?:\.\d+)?|[+\-*/%()]|\*\*/g;
        let match;
        while ((match = regex.exec(expr)) !== null) {
            tokens.push(match[0]);
        }

        if (tokens.length === 0) return null;

        const values: number[] = [];
        const ops: string[] = [];

        const precedence = (op: string): number => {
            if (op === "+" || op === "-") return 1;
            if (op === "*" || op === "/" || op === "%") return 2;
            if (op === "**") return 3;
            return 0;
        };

        const applyOp = (op: string, b: number, a: number): number => {
            switch (op) {
                case "+": return a + b;
                case "-": return a - b;
                case "*": return a * b;
                case "/": 
                    if (b === 0) throw new Error("Division by zero");
                    return a / b;
                case "%": return a % b;
                case "**": return Math.pow(a, b);
                default: return 0;
            }
        };

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if (!isNaN(parseFloat(token))) {
                values.push(parseFloat(token));
            } else if (token === "(") {
                ops.push(token);
            } else if (token === ")") {
                while (ops.length > 0 && ops[ops.length - 1] !== "(") {
                    const op = ops.pop()!;
                    const val2 = values.pop();
                    const val1 = values.pop();
                    if (val1 === undefined || val2 === undefined) throw new Error("Invalid expression");
                    values.push(applyOp(op, val2, val1));
                }
                if (ops.length === 0 || ops.pop() !== "(") throw new Error("Mismatched parentheses");
            } else {
                // Operator (+, -, *, /, %, **)
                // Check for unary minus
                if (token === "-" && (i === 0 || tokens[i - 1] === "(" || ["+", "-", "*", "/", "%", "**"].includes(tokens[i - 1]))) {
                    // Unary negative number
                    if (i + 1 < tokens.length && !isNaN(parseFloat(tokens[i + 1]))) {
                        values.push(-parseFloat(tokens[i + 1]));
                        i++;
                        continue;
                    }
                }

                while (ops.length > 0 && precedence(ops[ops.length - 1]) >= precedence(token) && token !== "**") {
                    const op = ops.pop()!;
                    const val2 = values.pop();
                    const val1 = values.pop();
                    if (val1 === undefined || val2 === undefined) throw new Error("Invalid expression");
                    values.push(applyOp(op, val2, val1));
                }
                ops.push(token);
            }
        }

        while (ops.length > 0) {
            const op = ops.pop()!;
            if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
            const val2 = values.pop();
            const val1 = values.pop();
            if (val1 === undefined || val2 === undefined) throw new Error("Invalid expression");
            values.push(applyOp(op, val2, val1));
        }

        if (values.length !== 1) return null;
        const result = values[0];
        return isFinite(result) ? result : null;
    }
}
