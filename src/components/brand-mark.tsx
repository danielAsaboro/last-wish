type BrandMarkProps = {
  tone?: "default" | "inverse";
};

export function BrandMark({ tone = "default" }: BrandMarkProps) {
  const outer = tone === "inverse" ? "#fbf8f1" : "#17211c";
  const detail = tone === "inverse" ? "#17211c" : "#fbf8f1";

  return (
    <svg className="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="30" fill={outer} />
      <circle cx="32" cy="32" r="20" fill="none" stroke={detail} strokeWidth="2.75" />
      <circle cx="32" cy="32" r="13" fill="none" stroke="#6f8d79" strokeWidth="2" />
      <path d="M32 31V19M33 33l10 6M31 33l-10 6" fill="none" stroke={detail} strokeLinecap="round" strokeWidth="3" />
      <circle cx="32" cy="32" r="4.5" fill="#b56c24" />
      <circle cx="32" cy="19" r="1.75" fill={detail} />
      <circle cx="43" cy="39" r="1.75" fill={detail} />
      <circle cx="21" cy="39" r="1.75" fill={detail} />
    </svg>
  );
}
