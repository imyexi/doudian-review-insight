import type { ReactElement } from "react";

interface EmptyShopStateProps {
  body: string;
  kicker: string;
  title: string;
}

export function EmptyShopState({ body, kicker, title }: EmptyShopStateProps): ReactElement {
  return (
    <div className="empty-state surface">
      <span className="eyebrow">{kicker}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
