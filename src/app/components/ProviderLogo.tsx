import Image from "next/image";

type Provider = "fiber" | "similarweb";

const META: Record<
  Provider,
  { label: string; src: string; width: number; height: number }
> = {
  fiber: { label: "Fiber.ai", src: "/logos/fiber.ico", width: 16, height: 16 },
  similarweb: { label: "Similarweb", src: "/logos/similarweb.ico", width: 16, height: 16 },
};

export default function ProviderLogo({
  provider,
  size = 16,
  showLabel = false,
}: {
  provider: Provider;
  size?: number;
  showLabel?: boolean;
}) {
  const m = META[provider];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
      }}
    >
      <Image
        src={m.src}
        alt={m.label}
        width={size}
        height={size}
        unoptimized
        style={{ borderRadius: 3, objectFit: "contain" }}
      />
      {showLabel && (
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>{m.label}</span>
      )}
    </span>
  );
}
