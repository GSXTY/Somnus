import { useState } from "react";
import { Button } from "antd";
/** Bounded presentation only: records remain read-only and never execute content. */
export function StructuredRecord({ text }: {
    text: string;
}) {
    const [raw, setRaw] = useState(false);
    let value: unknown;
    try {
        value = JSON.parse(text);
    }
    catch {
        value = undefined;
    }
    const object = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
    return <div className="runtime-structured-record">
    {object && <Button size="small" onClick={() => setRaw(!raw)}>{raw ? "结构化视图" : "原始 JSON"}</Button>}
    {object && !raw ? <dl>{Object.entries(object).map(([key, item]) => <div key={key}>
      <dt>{key}</dt><dd>{typeof item === "string" ? <pre>{item}</pre> : <pre>{JSON.stringify(item, null, 2)}</pre>}</dd>
    </div>)}</dl> : <pre className="runtime-tool-inspector">{text}</pre>}
  </div>;
}
