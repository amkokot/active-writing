import type { ManuscriptNode, Paragraph, ThemeLens } from "./types";

export const manuscriptNodes: ManuscriptNode[] = [
  { id: "abstract", title: "Abstract", kind: "section", depth: 0, paragraphIds: ["p-abstract"] },
  { id: "intro", number: "1", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p-intro-1", "p-intro-2"] },
  { id: "motivation", parentId: "intro", number: "1.1", title: "Motivation", kind: "subsection", depth: 1, paragraphIds: ["p-motivation-1", "p-motivation-2"] },
  { id: "model", number: "2", title: "Model", kind: "section", depth: 0, paragraphIds: ["p-model-1", "p-model-2"] },
  { id: "identification", number: "3", title: "Identification", kind: "section", depth: 0, paragraphIds: ["p-identification-1"] },
  { id: "main-result", parentId: "identification", number: "3.2", title: "Main result", kind: "subsection", depth: 1, paragraphIds: ["p-main-1", "p-main-2", "p-main-3"] },
  { id: "lemma-1", parentId: "main-result", title: "Lemma 1 · Completeness", kind: "lemma", depth: 2, paragraphIds: ["p-lemma-1"] },
  { id: "proof-lemma-1", parentId: "lemma-1", title: "Proof", kind: "proof", depth: 3, paragraphIds: ["p-proof-lemma-1"] },
  { id: "theorem-1", parentId: "main-result", title: "Theorem 1 · Identification", kind: "theorem", depth: 2, paragraphIds: ["p-theorem-1"] },
  { id: "proof-theorem-1", parentId: "theorem-1", title: "Proof", kind: "proof", depth: 3, paragraphIds: ["p-proof-theorem-1"] },
  { id: "corollary-1", parentId: "main-result", title: "Corollary 1 · Observable moments", kind: "corollary", depth: 2, paragraphIds: ["p-corollary-1"] },
  { id: "estimation", number: "4", title: "Estimation", kind: "section", depth: 0, paragraphIds: ["p-estimation-1", "p-estimation-2"] },
  { id: "appendix", title: "Appendix", kind: "section", depth: 0, paragraphIds: ["p-appendix-1"] },
];

export const paragraphs: Paragraph[] = [
  { id: "p-abstract", nodeId: "abstract", text: "We study identification with repeated, imperfect measurements of a latent economic quantity. The analysis separates the economic restrictions of the model from the statistical information supplied by multiple proxies." },
  { id: "p-intro-1", nodeId: "intro", text: "Empirical researchers frequently observe proxies rather than the economic quantities that appear in their models. Treating one proxy as error-free can make substantive conclusions depend on an arbitrary measurement choice." },
  { id: "p-intro-2", nodeId: "intro", text: "This paper develops an identification argument that treats the available measurements symmetrically. The central idea recurs in the model, the main theorem, and the construction of the estimator." },
  { id: "p-motivation-1", nodeId: "motivation", text: "Researchers rarely observe the economic quantity of interest directly. Instead, several noisy measurements each preserve part of the same underlying signal." },
  { id: "p-motivation-2", nodeId: "motivation", text: "The availability of repeated measurements creates information, but only when their shared and idiosyncratic components are clearly distinguished." },
  { id: "p-model-1", nodeId: "model", text: "Let the two observed measurements equal a common latent state plus measurement-specific disturbances. Conditional independence separates the shared signal from the idiosyncratic components." },
  { id: "p-model-2", nodeId: "model", text: "Neither measurement is designated as ground truth. Both may contain nonclassical error, provided the conditional operator satisfies the completeness condition stated below." },
  { id: "p-identification-1", nodeId: "identification", text: "This section establishes when the latent distribution is uniquely determined by observable moments. The key restriction is a stable relationship across measurements rather than a parametric distributional assumption." },
  { id: "p-main-1", nodeId: "main-result", text: "Repeated measurements give two imperfect views of the same latent quantity. Their disagreement is informative: it isolates measurement error without requiring either observation to be treated as ground truth." },
  { id: "p-main-2", nodeId: "main-result", text: "The following theorem formalizes this intuition. Completeness converts equality of observable conditional moments into equality of the underlying latent distributions." },
  { id: "p-main-3", nodeId: "main-result", text: "The result matters empirically because no single proxy must be privileged. Identification comes from the structure of their shared signal and the independence of their idiosyncratic errors." },
  { id: "p-lemma-1", nodeId: "lemma-1", kind: "statement", text: "Under Assumption 2, if the conditional expectation of a square-integrable function vanishes for every observed value, then that function is zero almost surely." },
  { id: "p-proof-lemma-1", nodeId: "proof-lemma-1", kind: "proof", text: "Let the conditional operator be denoted by T. Its characteristic function is nonzero on the support, so the null space of T is trivial. The conclusion follows by inversion." },
  { id: "p-theorem-1", nodeId: "theorem-1", kind: "statement", text: "If Assumptions 1–3 hold, the joint distribution of the latent state and both measurement errors is identified from the distribution of the observables." },
  { id: "p-proof-theorem-1", nodeId: "proof-theorem-1", kind: "proof", text: "Apply Lemma 1 to the equality of conditional moments implied by the two measurement equations. This identifies the conditional law of the latent state. Substitution then recovers each error distribution. [Complete the support argument.]" },
  { id: "p-corollary-1", nodeId: "corollary-1", kind: "statement", text: "The first two latent moments are identified whenever their observable counterparts are finite." },
  { id: "p-estimation-1", nodeId: "estimation", text: "The estimator uses both noisy measurements symmetrically and mirrors the population identification argument." },
  { id: "p-estimation-2", nodeId: "estimation", text: "Sampling error replaces exact equality of conditional moments with a regularized minimum-distance criterion." },
  { id: "p-appendix-1", nodeId: "appendix", text: "The appendix collects auxiliary bounds, additional proofs, and implementation details." },
];

export const defaultThemeLenses: ThemeLens[] = [
  {
    id: "theme-measurement-error",
    name: "Measurement error",
    seedParagraphId: "p-main-1",
    matches: [
      { paragraphId: "p-motivation-1", score: 1, pinned: true },
      { paragraphId: "p-model-2", score: 0.88 },
      { paragraphId: "p-main-1", score: 0.94 },
      { paragraphId: "p-main-3", score: 0.81 },
      { paragraphId: "p-estimation-1", score: 0.73 },
    ],
  },
  {
    id: "theme-identification-intuition",
    name: "Identification intuition",
    seedParagraphId: "p-main-2",
    matches: [
      { paragraphId: "p-intro-2", score: 0.82 },
      { paragraphId: "p-identification-1", score: 0.88 },
      { paragraphId: "p-main-2", score: 1, pinned: true },
      { paragraphId: "p-estimation-1", score: 0.71 },
    ],
  },
];
