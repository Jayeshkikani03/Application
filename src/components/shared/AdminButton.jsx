const VARIANT_CLASS = {
  primary: "admin-button--primary",
  secondary: "admin-button--secondary",
};

export function AdminButton({
  variant = "secondary",
  type = "button",
  className = "",
  children,
  ...props
}) {
  const variantClass = VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary;

  return (
    <button
      type={type}
      className={["btn", "admin-button", variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
