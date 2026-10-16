// English is the key reference. Arabic must provide every key (enforced by
// the `Messages` type) so neither language ever falls behind the other.
export const en = {
  app: {
    name: "Veloq",
    tagline: "Project management for tech teams",
  },
  common: {
    save: "Save",
    cancel: "Cancel",
    create: "Create",
    loading: "Loading…",
    language: "Language",
    signOut: "Sign out",
    back: "Back",
  },
  auth: {
    signIn: "Sign in",
    signUp: "Create account",
    name: "Name",
    email: "Email",
    password: "Password",
    noAccount: "No account yet?",
    haveAccount: "Already have an account?",
  },
  workspaces: {
    title: "Your workspaces",
    empty: "You are not in any workspace yet. Create one to start.",
    create: "New workspace",
    name: "Workspace name",
    slug: "Workspace URL",
    slugHint: "Lowercase letters, numbers and hyphens",
    role: "Your role: {{role}}",
  },
  members: {
    title: "Members",
    add: "Add member",
    email: "Member email",
    role: "Role",
  },
  roles: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    guest: "Guest",
  },
  audit: {
    title: "Audit log",
    empty: "No activity yet.",
    actions: {
      "workspace.created": "{{actor}} created the workspace",
      "member.added": "{{actor}} added {{target}} as {{role}}",
      "member.roleChanged": "{{actor}} changed {{target}} to {{role}}",
      "member.removed": "{{actor}} removed {{target}}",
    },
  },
  errors: {
    unauthorized: "Please sign in.",
    forbidden: "You do not have permission to do this.",
    notFound: "Not found.",
    invalid: "Some fields are not valid.",
    slugTaken: "This URL is already taken.",
    userNotFound: "No user with this email. They need to create an account first.",
    alreadyMember: "This user is already a member.",
    lastOwner: "A workspace must keep at least one owner.",
    generic: "Something went wrong. Please try again.",
  },
};

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
