/** 内嵌 JSON-LD 结构化数据 */
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data);
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
