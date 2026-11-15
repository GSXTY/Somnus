import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Radio, Spin, Tag } from 'antd';
import { ApiOutlined, GlobalOutlined, SearchOutlined } from '@ant-design/icons';
import './mcp-market.css';

export type MarketInput = {
  id: string; label: string; description?: string; required?: boolean; secret?: boolean;
  target: 'header'; template?: string;
};
export type MarketVariant = { transport: 'http'; label: string; url: string; inputs: MarketInput[] };
export type MarketServer = {
  name: string; title: string; description: string; version: string;
  websiteUrl?: string; repositoryUrl?: string; variants: MarketVariant[];
};
type MarketPage = { servers: MarketServer[]; next_cursor: string | null };
const directory = '/api/mcp/market';
const source = 'https://registry.modelcontextprotocol.io/';

function externalLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function McpMarket({ active, disabled, onSelect }: {
  active: boolean; disabled: boolean; onSelect: (server: MarketServer, variant: MarketVariant) => void;
}) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [version, setVersion] = useState(0);
  const [page, setPage] = useState<MarketPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [selection, setSelection] = useState<MarketServer>();
  const [variant, setVariant] = useState(0);
  const controller = useRef<AbortController>();
  const selectionVariant = selection?.variants[variant];

  async function readPage(search: string, cursor?: string) {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const params = new URLSearchParams();
    if (search) params.set('query', search);
    if (cursor) params.set('cursor', cursor);
    setLoading(true);
    setError('');
    if (!cursor) setPage(undefined);
    try {
      const response = await fetch(directory + '?' + params, { cache: 'no-store', signal: pending.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(result?.servers)) {
        throw new Error(typeof result?.error === 'string' ? result.error : '无法读取公开 MCP 目录');
      }
      if (!pending.signal.aborted) {
        setPage(previous => {
          if (!cursor || !previous) return result as MarketPage;
          const servers = new Map(previous.servers.map(server => [server.name, server]));
          for (const server of result.servers as MarketServer[]) servers.set(server.name, server);
          return { servers: Array.from(servers.values()), next_cursor: result.next_cursor };
        });
      }
    } catch (failure) {
      if (!pending.signal.aborted) setError(failure instanceof Error ? failure.message : '无法读取公开 MCP 目录');
    } finally {
      if (!pending.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void readPage(submitted);
    return () => controller.current?.abort();
  }, [active, submitted, version]);

  function search(value: string) {
    const term = value.trim();
    if (term && [...term].length < 3) {
      setQueryError('搜索时请输入至少 3 个字符。也可以清空关键字浏览目录。');
      return;
    }
    setQueryError('');
    if (term === submitted) setVersion(current => current + 1);
    else setSubmitted(term);
  }

  const selectedSource = externalLink(selection?.websiteUrl) || externalLink(selection?.repositoryUrl);
  return <section className="mcp-market" aria-labelledby="mcp-market-title">
    <div className="mcp-market-heading">
      <div>
        <h2 id="mcp-market-title">MCP 市场</h2>
        <p>搜索官方公开目录，将支持 HTTPS 的服务添加到「我的服务器」。</p>
      </div>
      <a href={source} target="_blank" rel="noreferrer"><GlobalOutlined /> 官方目录</a>
    </div>
    <Input.Search className="mcp-market-search" prefix={<SearchOutlined />} placeholder="搜索 MCP 服务器名称"
      aria-label="搜索 MCP 市场" value={query} maxLength={160} allowClear enterButton="搜索"
      onChange={event => {
        setQuery(event.target.value);
        setQueryError('');
        if (event.target.value === '' && submitted) search('');
      }} onSearch={search} />
    {queryError && <div role="alert" className="mcp-market-note">{queryError}</div>}
    {error && <Alert type="error" showIcon message={error} />}
    {loading && !page && <div role="status" className="mcp-market-loading"><Spin size="small" /> 正在读取目录</div>}
    {!loading && page && !page.servers.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的 MCP 服务器" />}
    {page && <div className="mcp-market-results" aria-label="MCP 市场搜索结果">
      {page.servers.map(server => <article className="mcp-market-result" key={server.name}>
        <span className="mcp-market-icon" aria-hidden="true"><ApiOutlined /></span>
        <div className="mcp-market-copy">
          <h3>{server.title || server.name}</h3>
          {server.title && server.title !== server.name && <small>{server.name}</small>}
          {server.description && <p>{server.description}</p>}
        </div>
        <div className="mcp-market-actions">
          <Tag>{server.variants.length ? 'HTTPS' : '查看接入方式'}</Tag>
          <Button disabled={disabled} aria-label={'查看 ' + (server.title || server.name) + ' 详情'}
            onClick={() => { setSelection(server); setVariant(0); }}>查看详情</Button>
        </div>
      </article>)}
    </div>}
    {page?.next_cursor && <Button className="mcp-market-more" loading={loading}
      onClick={() => { if (page.next_cursor) void readPage(submitted, page.next_cursor); }}>加载更多</Button>}
    <Modal title={selection?.title || selection?.name || 'MCP 服务器详情'} open={Boolean(selection)}
      okText="使用此配置" cancelText="关闭" okButtonProps={{ disabled: !selectionVariant || disabled }}
      onCancel={() => setSelection(undefined)} onOk={() => {
        if (!selection || !selectionVariant) return;
        onSelect(selection, selectionVariant);
        setSelection(undefined);
      }}>
      {selection && <div className="mcp-market-detail">
        <dl><dt>服务器</dt><dd>{selection.name}</dd>
          {selection.version && <><dt>版本</dt><dd>{selection.version}</dd></>}
        </dl>
        {selection.description && <p>{selection.description}</p>}
        {selectedSource && <a href={selectedSource} target="_blank" rel="noreferrer">查看发布者文档</a>}
        {selection.variants.length ? <Radio.Group className="mcp-market-variants" value={variant}
          aria-label="选择 MCP 连接地址" onChange={event => setVariant(event.target.value)}>
          {selection.variants.map((item, index) => <Radio key={index} value={index}>
            <strong>{item.label}</strong><small>{item.url}</small>
          </Radio>)}
        </Radio.Group> : <Alert type="info" showIcon message="目录暂无可直接添加的 HTTPS 配置。请查看发布者文档了解接入方式。" />}
        {selectionVariant && <p className="mcp-market-note">如果发布者要求 API 密钥，请在下一步填写。若要求网页登录，请先查看发布者的授权说明。</p>}
      </div>}
    </Modal>
  </section>;
}
