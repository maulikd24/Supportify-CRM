import { Panel, PanelEmpty, PanelLink, PanelList, PanelRow } from "@/components/dashboard/panel";

export type NextAction = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  dueLabel: string;
  highPriority: boolean;
};

export function NextActions({ actions, total }: { actions: NextAction[]; total: number }) {
  return (
    <Panel
      eyebrow="Prioritised for you"
      title="Next best actions"
      action={<PanelLink href="/tasks">All tasks</PanelLink>}
      footer={`Showing ${actions.length} of ${total} · sorted by urgency`}
    >
      {actions.length === 0 ? (
        <PanelEmpty>Nothing here — you&apos;re all caught up.</PanelEmpty>
      ) : (
        <PanelList>
          {actions.map((a) => (
            <PanelRow
              key={a.id}
              tone={a.highPriority ? "primary" : "muted"}
              title={a.title}
              meta={`${a.clientName} · ${a.dueLabel}`}
              href={`/clients/${a.clientId}`}
              hrefLabel={`Start: ${a.title}`}
            />
          ))}
        </PanelList>
      )}
    </Panel>
  );
}
