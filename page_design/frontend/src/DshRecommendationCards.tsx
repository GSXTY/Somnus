import { AppstoreOutlined, LayoutOutlined, RightOutlined } from '@ant-design/icons';
import type { DshRecommendation } from './assistantApi';

export function DshRecommendationCards({ cards, onOpenPlugin }: {
  cards?: DshRecommendation[];
  onOpenPlugin?: (id: string) => void;
}) {
  if (!Array.isArray(cards) || !cards.length) return null;

  return <section className="assistant-dsh-recommendations" aria-label="DSH 个性化推荐">
    {cards.map(card => <article className="assistant-dsh-recommendation" key={card.id}>
      <span className="assistant-dsh-recommendation-icon" aria-hidden="true">
        {card.kind === 'plugin' ? <AppstoreOutlined /> : <LayoutOutlined />}
      </span>
      <div className="assistant-dsh-recommendation-copy">
        <small>{card.kind === 'plugin' ? 'DSH 插件推荐' : 'DSH 页面建议 · 预览'}</small>
        <strong>{card.title}</strong>
        {card.description && <p>{card.description}</p>}
      </div>
      {card.pluginId && onOpenPlugin && <button type="button" aria-label={'在插件市场查看 ' + card.title}
        onClick={() => { if (card.pluginId) onOpenPlugin(card.pluginId); }}>查看插件 <RightOutlined aria-hidden="true" /></button>}
    </article>)}
  </section>;
}
