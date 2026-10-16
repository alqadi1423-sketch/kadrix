import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IssueList } from "../components/issue-list";
import { useIssues, useLabels, useMe, useMembers } from "../lib/hooks";
import { useWorkspaceUi } from "../layout";
import { Button, Empty } from "../ui";

export function MyIssuesPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t } = useTranslation();
  const me = useMe();
  const ui = useWorkspaceUi();
  const issues = useIssues(slug, { assigneeId: me.data ? [me.data.user.id] : ["none"] });
  const labels = useLabels(slug);
  const members = useMembers(slug);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("nav.myIssues")}</h1>
        <Button onClick={() => ui.newIssue()}>{t("issues.newIssue")}</Button>
      </div>
      {issues.isLoading || !me.data ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : issues.data?.length ? (
        <IssueList slug={slug} issues={issues.data} labels={labels.data ?? []} members={members.data ?? []} canEdit />
      ) : (
        <Empty>{t("issues.empty")}</Empty>
      )}
    </div>
  );
}
