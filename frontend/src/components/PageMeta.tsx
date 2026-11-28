interface PageMetaProps {
  title: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  /** Páginas com segredo na URL (convites) não devem ser indexadas. */
  noindex?: boolean;
}

export default function PageMeta({ title, description, ogTitle, ogDescription, ogImage, noindex }: PageMetaProps) {
  const fullTitle = title.includes('Workyn') ? title : `${title} — Workyn`
  return (
    <>
      <title>{fullTitle}</title>
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      {description && <meta name="description" content={description} />}
      {ogTitle && <meta property="og:title" content={ogTitle} />}
      {ogDescription && <meta property="og:description" content={ogDescription} />}
      {ogImage && <meta property="og:image" content={ogImage} />}
    </>
  )
}
