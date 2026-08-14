export function BrandName({ as: Tag = "span", className = "" }) {
  return (
    <Tag className={`esource-brand-name ${className}`.trim()}>
      <span className="esource-brand-name__e">e</span>Source
    </Tag>
  );
}
