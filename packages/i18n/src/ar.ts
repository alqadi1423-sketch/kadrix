import type { Messages } from "./en.js";

export const ar: Messages = {
  app: {
    name: "Veloq",
    tagline: "إدارة المشاريع للفرق التقنية",
  },
  common: {
    save: "حفظ",
    cancel: "إلغاء",
    create: "إنشاء",
    loading: "جارٍ التحميل…",
    language: "اللغة",
    signOut: "تسجيل الخروج",
    back: "رجوع",
  },
  auth: {
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    name: "الاسم",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    noAccount: "ليس لديك حساب؟",
    haveAccount: "لديك حساب بالفعل؟",
  },
  workspaces: {
    title: "مساحات العمل",
    empty: "لست عضوًا في أي مساحة عمل بعد. أنشئ واحدة للبدء.",
    create: "مساحة عمل جديدة",
    name: "اسم مساحة العمل",
    slug: "رابط مساحة العمل",
    slugHint: "حروف إنجليزية صغيرة وأرقام وشرطات قصيرة",
    role: "دورك: {{role}}",
  },
  members: {
    title: "الأعضاء",
    add: "إضافة عضو",
    email: "بريد العضو",
    role: "الدور",
  },
  roles: {
    owner: "مالك",
    admin: "مدير",
    member: "عضو",
    guest: "ضيف",
  },
  audit: {
    title: "سجل النشاط",
    empty: "لا يوجد نشاط بعد.",
    actions: {
      "workspace.created": "أنشأ {{actor}} مساحة العمل",
      "member.added": "أضاف {{actor}} العضو {{target}} بدور {{role}}",
      "member.roleChanged": "غيّر {{actor}} دور {{target}} إلى {{role}}",
      "member.removed": "أزال {{actor}} العضو {{target}}",
    },
  },
  errors: {
    unauthorized: "يرجى تسجيل الدخول.",
    forbidden: "ليست لديك صلاحية لهذا الإجراء.",
    notFound: "غير موجود.",
    invalid: "بعض الحقول غير صحيحة.",
    slugTaken: "هذا الرابط مستخدم بالفعل.",
    userNotFound: "لا يوجد مستخدم بهذا البريد. يجب أن ينشئ حسابًا أولًا.",
    alreadyMember: "هذا المستخدم عضو بالفعل.",
    lastOwner: "يجب أن تحتفظ مساحة العمل بمالك واحد على الأقل.",
    generic: "حدث خطأ. حاول مرة أخرى.",
  },
};
