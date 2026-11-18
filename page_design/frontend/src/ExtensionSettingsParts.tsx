import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import './extensionSettings.css';

export function ExtensionHeading({ title, description, actions, icon, onBack }: {
  title: string; description?: string; actions?: ReactNode; icon?: ReactNode; onBack?: () => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const detail = Boolean(onBack);
  useEffect(() => { if (detail) back.current?.focus({ preventScroll: true }); }, [detail]);
  return <header className="extension-heading">
    {onBack && <button ref={back} type="button" className="extension-back" onClick={onBack}><LeftOutlined /> 返回列表</button>}
    <div className="extension-heading-line">
      {icon && <span className="extension-icon" aria-hidden="true">{icon}</span>}
      <div className="extension-heading-copy"><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {actions && <div className="extension-actions">{actions}</div>}
    </div>
  </header>;
}

export function ExtensionItem({ title, description, icon, status, actions, onOpen }: {
  title: string; description?: string; icon: ReactNode; status?: ReactNode; actions?: ReactNode; onOpen: () => void;
}) {
  return <li className="extension-item">
    <button type="button" className="extension-item-open" onClick={onOpen}>
      <span className="extension-icon" aria-hidden="true">{icon}</span>
      <span className="extension-item-copy"><strong>{title}</strong>{description && <span>{description}</span>}</span>
      <RightOutlined className="extension-chevron" aria-hidden="true" />
    </button>
    {(status || actions) && <div className="extension-actions">{status}{actions}</div>}
  </li>;
}
