import { Fragment, type ReactNode } from 'react';
import { clusterByBatch } from './batchGroups';

/**
 * Lista com cabeçalho de lote. Sem rótulos devolve só os itens (nenhum elemento a mais).
 * `as="li"` quando a lista é um `<ul>`.
 */
export default function BatchList<T>({ items, batchOf, labels, render, as }: {
    items: T[];
    batchOf: (item: T) => string | null | undefined;
    labels: Map<string, string>;
    render: (item: T) => ReactNode;
    as?: 'li';
}) {
    if (labels.size === 0) return <>{items.map(render)}</>;
    const Header = as ?? 'p';
    return (
        <>
            {clusterByBatch(items, batchOf, labels).map((cluster) => (
                <Fragment key={cluster.key}>
                    {cluster.label && <Header className="pt-1 text-xs font-bold text-gray-600">{cluster.label}</Header>}
                    {cluster.items.map(render)}
                </Fragment>
            ))}
        </>
    );
}
