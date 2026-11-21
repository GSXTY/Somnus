export type PluginField = {
    key: string;
    label: string;
    kind: 'string' | 'number' | 'boolean' | 'enum';
    value?: string | number | boolean;
    options?: string[];
};
export type PluginAction = {
    id?: string;
    label: string;
} & ({
    type: 'insertDraft';
    text: string;
} | {
    type: 'open-own-page';
    pageId: string;
} | {
    type: 'read-own-settings';
} | {
    type: 'save-own-settings';
    id: string;
    sectionId: string;
    revision: number;
});
export type PluginBlock = {
    type: 'text';
    text: string;
} | {
    type: 'metrics';
    items: {
        label: string;
        value: string;
    }[];
} | {
    type: 'list';
    items: string[];
} | {
    type: 'table';
    columns: {
        key: string;
        label: string;
    }[];
    rows: Record<string, string>[];
} | {
    type: 'chart';
    chartType: 'bar' | 'line';
    labels: string[];
    series: {
        label: string;
        values: number[];
    }[];
} | {
    type: 'status';
    label: string;
    state: 'idle' | 'running' | 'success' | 'error';
    detail?: string;
} | {
    type: 'form';
    fields: PluginField[];
    submitActionId: string;
};
export type PluginDocument = {
    version: 1;
    title?: string;
    blocks: PluginBlock[];
    actions?: PluginAction[];
};
