                                 // ============================================================
// src/lib/bjj-waiver-content.ts
// BJJ Dojo — Waiver & Release of Liability
// Bilingual content (English + Japanese)
// ============================================================
//
// DISCLAIMER: This is a general-purpose template and does NOT
// constitute legal advice. Have a licensed attorney review
// before use.
// ============================================================

export type WaiverSection = {
  id: string;
  titleEn: string;
  titleJa: string;
  bodyEn: string;
  bodyJa: string;
};

export type WaiverContent = {
  version: string;
  lastUpdated: string;
  titleEn: string;
  titleJa: string;
  introEn: string;
  introJa: string;
  sections: WaiverSection[];
  acknowledgmentEn: string;
  acknowledgmentJa: string;
  minorConsentEn: string;
  minorConsentJa: string;
};

export const BJJ_WAIVER: WaiverContent = {
  version: "1.0.0",
  lastUpdated: "2026-02-12",

  titleEn: "Waiver and Release of Liability",
  titleJa: "免責同意書（誓約書）",

  introEn:
    'In consideration of being permitted to participate in Brazilian Jiu-Jitsu (BJJ) classes, open mat sessions, seminars, competitions, and any other activities offered by the Dojo (hereinafter referred to as "the Academy"), I, the undersigned participant (or parent/legal guardian of a minor participant), acknowledge and agree to the following:',

  introJa:
    "ブラジリアン柔術（BJJ）のクラス、オープンマット、セミナー、大会、およびその他の道場（以下「本道場」）が提供するすべての活動への参加を許可されることを考慮し、私（署名者本人、または未成年参加者の親権者・法定後見人）は、以下の事項を理解し同意します。",

  sections: [
    {
      id: "assumption-of-risk",
      titleEn: "1. Assumption of Risk",
      titleJa: "1. 危険の認識と受容",
      bodyEn:
        "I understand and acknowledge that participation in Brazilian Jiu-Jitsu and related martial arts activities involves inherent risks of physical injury, including but not limited to: sprains, strains, fractures, dislocations, joint injuries, muscle tears, concussions, contusions, lacerations, skin infections (including but not limited to staph, ringworm, and impetigo), communicable diseases, and in rare cases, permanent disability or death. I understand these risks may result from my own actions, the actions of other participants, instruction received, the condition of the training facilities, or equipment used. I voluntarily assume all such risks, both known and unknown, even if arising from the negligence of the Academy, its owners, instructors, employees, or agents.",
      bodyJa:
        "ブラジリアン柔術およびその他の格闘技活動への参加には、捻挫、骨折、脱臼、関節損傷、筋断裂、脳震盪、打撲、裂傷、皮膚感染症（ブドウ球菌感染症、白癬、膿痂疹を含むがこれに限らない）、感染性疾患、そしてまれに後遺障害や死亡を含む、固有の身体的負傷のリスクが伴うことを理解し認識します。これらのリスクは、自身の行動、他の参加者の行動、指導内容、トレーニング施設の状態、または使用される器具に起因する可能性があることを理解しています。本道場、そのオーナー、指導者、従業員、または代理人の過失に起因する場合を含め、既知および未知のすべてのリスクを自発的に受け入れます。",
    },
    {
      id: "release-of-liability",
      titleEn: "2. Release of Liability",
      titleJa: "2. 責任の免除",
      bodyEn:
        'I, on behalf of myself, my heirs, personal representatives, and assigns, hereby release, waive, discharge, and hold harmless the Academy, its owners, officers, directors, instructors, employees, agents, volunteers, and affiliates (collectively, the "Released Parties") from any and all liability, claims, demands, actions, or rights of action whatsoever, arising out of or related to any loss, damage, or injury (including death) that may be sustained by me or to any property belonging to me while participating in any activities at or sponsored by the Academy, whether caused by the negligence of the Released Parties or otherwise.',
      bodyJa:
        "私は、自身、相続人、法定代理人、および権利承継者を代表して、本道場、そのオーナー、役員、取締役、指導者、従業員、代理人、ボランティア、および関係者（以下、総称して「免責当事者」）を、本道場でのまたは本道場が主催する活動への参加中に、私自身または私の所有物に生じ得るいかなる損失、損害、負傷（死亡を含む）に関する、あらゆる責任、請求、要求、訴訟、またはその権利から免除し、放棄し、解除します。これは、免責当事者の過失に起因する場合を含みます。",
    },
    {
      id: "indemnification",
      titleEn: "3. Indemnification",
      titleJa: "3. 補償",
      bodyEn:
        "I agree to indemnify and hold harmless the Released Parties from any loss, liability, damage, or costs (including attorney fees and court costs) they may incur arising out of or related to my participation in Academy activities, whether caused by my negligence or otherwise.",
      bodyJa:
        "私は、本道場での活動への参加に起因または関連して免責当事者に生じたいかなる損失、責任、損害、または費用（弁護士費用および裁判費用を含む）についても、私の過失の有無にかかわらず、免責当事者を補償し、一切の損害を与えないことに同意します。",
    },
    {
      id: "physical-fitness",
      titleEn: "4. Physical Fitness & Medical Acknowledgment",
      titleJa: "4. 身体的適性と医療に関する認識",
      bodyEn:
        "I affirm that I am in good physical condition and do not suffer from any disability or condition that would prevent or limit my safe participation in BJJ training. I agree to disclose any pre-existing medical conditions, injuries, or limitations to the Academy in writing before training. I understand that the Academy does not provide medical advice and that I should consult a physician before beginning any training program. I accept sole responsibility for any medical expenses incurred as a result of my participation.",
      bodyJa:
        "私は、良好な健康状態にあり、BJJトレーニングへの安全な参加を妨げる、または制限する障害や疾患がないことを確認します。トレーニング前に、既往症、怪我、または制限事項を書面で本道場に開示することに同意します。本道場は医学的助言を提供するものではなく、トレーニングプログラムを開始する前に医師に相談すべきであることを理解しています。参加に起因するいかなる医療費についても、自身が単独で責任を負うことを受け入れます。",
    },
    {
      id: "rules-and-conduct",
      titleEn: "5. Rules of Conduct",
      titleJa: "5. 行動規範",
      bodyEn:
        "I agree to follow all rules, guidelines, and instructions provided by the Academy and its instructors. I understand that I must immediately stop any technique or exercise if instructed to do so. I agree to tap out promptly when caught in a submission and to respect my training partners at all times. I understand that reckless, dangerous, or unsportsmanlike behavior may result in immediate removal from the Academy without refund. I agree that the skills learned at the Academy shall only be used for self-defense, sanctioned training, or competition.",
      bodyJa:
        "私は、本道場およびその指導者が提供するすべてのルール、ガイドライン、および指示に従うことに同意します。指示があった場合には直ちに技や運動を中止しなければならないことを理解しています。関節技や絞め技をかけられた際には速やかにタップアウトし、常にトレーニングパートナーを尊重することに同意します。無謀な行為、危険な行為、またはスポーツマンシップに反する行為は、返金なしに本道場から即時退場となる場合があることを理解しています。本道場で習得した技術は、正当防衛、公認のトレーニング、または試合においてのみ使用することに同意します。",
    },
    {
      id: "hygiene-and-health",
      titleEn: "6. Hygiene & Health Policy",
      titleJa: "6. 衛生と健康に関する方針",
      bodyEn:
        "I agree to maintain proper hygiene standards, including wearing a clean gi or training attire, trimming fingernails and toenails, and refraining from training if I have any open wounds, skin infections, contagious illnesses, or symptoms of communicable disease. I understand that failure to comply may result in my being asked to leave the training area.",
      bodyJa:
        "私は、清潔な道着またはトレーニングウェアの着用、手足の爪の適切な手入れ、および開放創、皮膚感染症、伝染性疾患の症状がある場合にはトレーニングを控えることを含む、適切な衛生基準を維持することに同意します。これに従わない場合、トレーニングエリアからの退出を求められる場合があることを理解しています。",
    },
    {
      id: "media-release",
      titleEn: "7. Photo & Media Release",
      titleJa: "7. 写真・メディアに関する同意",
      bodyEn:
        "I grant the Academy permission to use photographs, video recordings, and other media of my likeness taken during classes, events, or seminars for promotional, educational, or marketing purposes, including use on websites, social media, and printed materials. I waive any right to inspect or approve the finished content or to receive compensation for its use.",
      bodyJa:
        "私は、クラス、イベント、またはセミナー中に撮影された写真、動画、その他のメディアにおける私の肖像を、ウェブサイト、ソーシャルメディア、印刷物を含むプロモーション、教育、またはマーケティング目的で使用する許可を本道場に付与します。完成したコンテンツを検査または承認する権利、およびその使用に対する報酬を受ける権利を放棄します。",
    },
    {
      id: "emergency-medical",
      titleEn: "8. Emergency Medical Authorization",
      titleJa: "8. 緊急医療の承認",
      bodyEn:
        "In the event of an emergency, I authorize the Academy's staff to seek and obtain emergency medical treatment on my behalf if I am unable to do so myself. I understand that any costs associated with such treatment will be my sole responsibility.",
      bodyJa:
        "緊急時に私自身が対応できない場合、本道場のスタッフが私に代わって緊急医療を求め、受けることを承認します。そのような治療に関連するすべての費用は、私自身が単独で負担することを理解しています。",
    },
    {
      id: "governing-law",
      titleEn: "9. Governing Law",
      titleJa: "9. 準拠法",
      bodyEn:
        "This waiver shall be governed by and construed in accordance with the laws of the jurisdiction in which the Academy is located. Any disputes arising under this agreement shall be resolved in the courts of that jurisdiction.",
      bodyJa:
        "本同意書は、本道場が所在する法域の法律に準拠し、それに従って解釈されるものとします。本同意書に基づいて生じた紛争は、当該法域の裁判所において解決されるものとします。",
    },
    {
      id: "severability",
      titleEn: "10. Severability",
      titleJa: "10. 可分性",
      bodyEn:
        "If any provision of this waiver is found to be invalid, illegal, or unenforceable by a court of competent jurisdiction, the remaining provisions shall remain in full force and effect.",
      bodyJa:
        "本同意書のいずれかの条項が管轄裁判所により無効、違法、または執行不能と判断された場合でも、残りの条項は引き続き完全に有効であるものとします。",
    },
    {
      id: "entire-agreement",
      titleEn: "11. Entire Agreement",
      titleJa: "11. 完全合意",
      bodyEn:
        "This document constitutes the entire agreement between the participant and the Academy regarding liability and risk. No oral or written representations other than those contained herein shall be binding.",
      bodyJa:
        "本書は、責任およびリスクに関する参加者と本道場との間の完全な合意を構成するものとします。本書に含まれるもの以外の口頭または書面による表明は拘束力を持ちません。",
    },
  ],

  acknowledgmentEn:
    "I HAVE READ THIS WAIVER AND RELEASE OF LIABILITY, FULLY UNDERSTAND ITS TERMS, AND SIGN IT FREELY AND VOLUNTARILY WITHOUT ANY INDUCEMENT. I understand that by signing this document I am giving up substantial legal rights, including the right to sue the Academy, its owners, instructors, and agents for injuries resulting from the inherent risks of Brazilian Jiu-Jitsu.",

  acknowledgmentJa:
    "私は本免責同意書を読み、その内容を完全に理解した上で、いかなる誘因もなく自由かつ自発的に署名します。本書に署名することにより、ブラジリアン柔術に内在するリスクに起因する負傷について、本道場、そのオーナー、指導者、および代理人を訴える権利を含む重要な法的権利を放棄することを理解しています。",

  minorConsentEn:
    "I am the parent or legal guardian of the minor named above. I have read this entire Waiver and Release of Liability and I understand and agree to its terms on behalf of the minor. I consent to the minor's participation in Brazilian Jiu-Jitsu activities at the Academy and I accept full responsibility for any risks, injuries, or damages that may occur. I agree to indemnify and hold harmless the Released Parties from any claims brought by or on behalf of the minor.",

  minorConsentJa:
    "私は、上記の未成年者の親権者または法定後見人です。本免責同意書の全文を読み、未成年者を代理してその内容を理解し同意します。本道場でのブラジリアン柔術活動への未成年者の参加に同意し、発生し得るすべてのリスク、負傷、または損害について全責任を負います。未成年者によるまたは未成年者を代理した請求から、免責当事者を補償し、一切の損害を与えないことに同意します。",
};

// ── Helper: Get content by locale ────────────────────────────
export type Locale = "en" | "ja";

export function getWaiverTitle(locale: Locale): string {
  return locale === "ja" ? BJJ_WAIVER.titleJa : BJJ_WAIVER.titleEn;
}

export function getWaiverIntro(locale: Locale): string {
  return locale === "ja" ? BJJ_WAIVER.introJa : BJJ_WAIVER.introEn;
}

export function getWaiverSections(locale: Locale) {
  return BJJ_WAIVER.sections.map((s) => ({
    id: s.id,
    title: locale === "ja" ? s.titleJa : s.titleEn,
    body: locale === "ja" ? s.bodyJa : s.bodyEn,
  }));
}

export function getAcknowledgment(locale: Locale): string {
  return locale === "ja"
    ? BJJ_WAIVER.acknowledgmentJa
    : BJJ_WAIVER.acknowledgmentEn;
}

export function getMinorConsent(locale: Locale): string {
  return locale === "ja"
    ? BJJ_WAIVER.minorConsentJa
    : BJJ_WAIVER.minorConsentEn;
}