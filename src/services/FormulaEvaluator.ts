/**
 * Safe, zero-LLM spreadsheet-style formula evaluator for custom calculated health metrics.
 * Supports standard arithmetic operations (+, -, *, /, ^, %), parentheses, and variable substitutions.
 */

export class FormulaEvaluator {
    /**
     * Extracts variable identifiers used inside a formula string.
     * e.g. "(protein * 4) + (carbs * 4) + (fat * 9)" -> ["protein", "carbs", "fat"]
     */
    public static extractVariables(formula: string): string[] {
        if (!formula || !formula.trim()) return [];
        const matches = formula.match(/[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
        // Filter out any math function names or reserved words if needed
        const reserved = new Set(["min", "max", "round", "abs", "floor", "ceil", "sqrt"]);
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
     * Returns null if any required variable is missing or if division by zero occurs.
     */
    public static evaluate(formula: string, context: Record<string, any>): number | null {
        if (!formula || !formula.trim()) return null;

        const variables = this.extractVariables(formula);
        let expression = formula;

        // Check and replace each variable with its numeric value
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
                // Optional / absent numeric fields (e.g. alcohol, alcohol_prev) default to 0
                if (varName.toLowerCase().includes("alcohol") || varName.toLowerCase().includes("caff") || varName.toLowerCase().includes("workout") || varName.toLowerCase().endsWith("_prev") || varName.toLowerCase().endsWith("_yesterday")) {
                    val = 0;
                } else {
                    return null;
                }
            }

            const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
            if (isNaN(num)) return null;

            // Replace full variable token using regex word boundaries
            const regex = new RegExp(`\\b${varName}\\b`, "g");
            expression = expression.replace(regex, `(${num})`);
        }

        // Tokenize and evaluate arithmetic using Shunting-yard algorithm
        try {
            return this.evaluateArithmetic(expression);
        } catch (e) {
            return null;
        }
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
