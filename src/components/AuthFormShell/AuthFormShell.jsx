export default function AuthFormShell({
  className,
  iconSrc,
  iconAlt,
  title,
  message,
  onSubmit,
  children,
  autoComplete = "off",
}) {
  return (
    <main className={className}>
      <section>
        <img src={iconSrc} alt={iconAlt} />
      </section>
      <section>
        <form autoComplete={autoComplete} onSubmit={onSubmit}>
          <h1>{title}</h1>
          <p>{message}</p>
          {children}
        </form>
      </section>
    </main>
  );
}
