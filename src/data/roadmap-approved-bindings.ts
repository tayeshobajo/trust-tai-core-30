import type { Roadmap } from "@/domain/roadmap";
import type { ReviewedBinding } from "@/domain/roadmap-evidence";
// Approved canonical batch receipt b63265d9-cc34-4012-a9ea-924e6e51db99; identity links only, no message bodies.
const organizationId = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const entries = [
  {
    slug: "highview",
    roadmapId: "55d288a0-e8f1-5f54-aa4a-61afbd77368e",
    relationshipId: "a670e5ea-fcb8-566e-803a-60233f82fcf3",
    prospectId: "aa2dbb75-63d2-5f6c-bd57-95eff0b06d67",
  },
  {
    slug: "nashville-cleaning-company",
    roadmapId: "3d609d0a-0b3a-56d2-9a41-d8052895729c",
    relationshipId: "ceab6176-ded2-5df8-be8c-380d680eee58",
    prospectId: "6dfef69b-4de0-52d3-9bc4-3d6cad603794",
  },
  {
    slug: "kpayne-contracting",
    roadmapId: "0c1b5da4-3676-5695-82b6-1d916d372608",
    relationshipId: "52c4d80e-97e5-504e-ae84-068f5999a6e8",
    prospectId: "a768e7d3-2f60-508c-9363-81c17037b449",
  },
  {
    slug: "sequatchie",
    roadmapId: "4c8949eb-e361-5247-b945-b93807d76a10",
    relationshipId: "8629da69-0c57-5a26-9fcd-caf9974cc60d",
    prospectId: "a4a0e09e-5158-5990-8833-96b4fa08ef8b",
  },
  {
    slug: "olive-sinclair",
    roadmapId: "11c3e97d-2c5a-59c8-90aa-dd868e7d7220",
    relationshipId: "cc9c334c-5414-5be6-bd22-31157b96d42f",
    prospectId: "b39c1ba0-7b01-597c-886c-892e98ce7b80",
  },
  {
    slug: "startup-your-hr",
    roadmapId: "d7ac00c4-bd26-5204-b5b8-741c001d7c35",
    relationshipId: "1abc74dc-9286-559f-816b-41f652919802",
    prospectId: "47b8ed98-5a0e-5e39-b16c-cc74537d6273",
  },
  {
    slug: "ta-bookkeeping",
    roadmapId: "46e06e60-39d7-556b-8b5d-63ad9d5f2750",
    relationshipId: "8698c050-d309-5cfd-b353-05cb160c7f2c",
    prospectId: "f6f710e3-cc7f-5e8e-adc5-c80b7bb89d6a",
  },
  {
    slug: "bradley-inspection",
    roadmapId: "4329dcb8-f0ff-547f-b800-7806330277cf",
    relationshipId: "3518f213-5075-5491-9726-27193d474ddb",
    prospectId: "5bf8dffc-3dad-54cc-90e1-24e7176cdaaf",
  },
  {
    slug: "dreamscapes",
    roadmapId: "8c5118bb-6d23-5905-b1f6-06bfe9ecc4e6",
    relationshipId: "0f4fc7aa-cfa5-5740-8490-bca2f73a4949",
    prospectId: "83f0660c-960a-5b2c-8ac6-c1f3f4a0d12d",
  },
  {
    slug: "mud-puddle",
    roadmapId: "a8c446f2-8d39-576d-98c6-a24204485e54",
    relationshipId: "21a109fe-ea6d-5302-beb3-bd6f4b14e3f7",
    prospectId: "531ff9dc-d325-5a8f-9c1e-a46f51b3da7b",
  },
  {
    slug: "pop-up-project-studio34",
    roadmapId: "5ab8db33-1c7f-5b38-8e1b-a8498abfd6fc",
    relationshipId: "67478ad8-deec-501c-9419-366ea56d089f",
    prospectId: "f11eaf4f-6a05-55c2-9a5e-d5ca97895c2e",
  },
  {
    slug: "the-chattery",
    roadmapId: "7a5f5eb7-b3bf-5b85-af20-58e2e1a43853",
    relationshipId: "1ca6c03b-6fb9-5cd6-966d-4ada4407bee3",
    prospectId: "7089aa86-01cf-52b5-a543-18949e8f31e9",
  },
  {
    slug: "lookout-bookkeeping",
    roadmapId: "441bb901-56ce-5721-b173-0ce6273d5d3c",
    relationshipId: "448e97c1-f74f-5dc8-9c06-06a516440f6d",
    prospectId: "59345e56-f54e-5ad9-8fb2-ca520c1ab159",
  },
  {
    slug: "noble-springs-dairy",
    roadmapId: "9cb61c49-13c9-5cfd-938f-94ef72296396",
    relationshipId: "0d113e71-bd83-5df6-81c0-aedb5ae9e081",
    prospectId: "beeb5d24-a7a0-53dc-b701-bce1aaf5e7ed",
  },
  {
    slug: "ryan-partners",
    roadmapId: "fa46b315-e865-51b6-a206-911a368328d0",
    relationshipId: "8f84a87b-0d5d-554b-ba58-6a34786a4c3f",
    prospectId: "9b8e891b-68b7-5a5b-b1ad-6d1f84a12ada",
  },
  {
    slug: "lester",
    roadmapId: "980facff-7c87-5331-ae39-caa04266bd3d",
    relationshipId: "7b981f94-6bd1-445c-afa8-e9a13cc14513",
    prospectId: null,
  },
  {
    slug: "360-tax-solutions",
    roadmapId: "e3ba9f62-6c8e-5cd0-9c49-957f7bacbf74",
    relationshipId: "1feed24f-4842-5de2-aeaa-a93c3199a3a1",
    prospectId: "156c7232-d627-5eb6-bf27-27b203a86615",
  },
  {
    slug: "sherri-clarke",
    roadmapId: "40e2875a-c548-5c3a-9ddf-1c8ce91503d1",
    relationshipId: "4cf954e7-d4a6-548c-a390-3087a2e4cd24",
    prospectId: "463fa007-ea33-50d9-bc9c-bf396bdd4f16",
  },
  {
    slug: "rejuvenate",
    roadmapId: "f4cf09b3-75ab-5778-acca-f6f6c3882840",
    relationshipId: "6d54503b-2b0b-4677-a15f-0512386fd9b5",
    prospectId: null,
  },
  {
    slug: "sbrc",
    roadmapId: "374eef61-b1b8-5bc3-aa01-a3b72ab9d35b",
    relationshipId: "0ac885f8-94a7-4e2f-b45d-9facc5778efd",
    prospectId: null,
  },
  {
    slug: "elevate",
    roadmapId: "01121437-5bf1-5846-adb2-51b637ccbd88",
    relationshipId: "0d37a16b-3067-4f8d-8eca-ef93246d9fdb",
    prospectId: null,
  },
  {
    slug: "epay",
    roadmapId: "525c0425-0cd9-58bf-a421-c8a2fa38b410",
    relationshipId: "e7182d32-149c-4a69-b708-1b9f706296c6",
    prospectId: null,
  },
] as const;
export function approvedCanonicalBindings(roadmaps: Roadmap[], org: string): ReviewedBinding[] {
  if (org !== organizationId) return [];
  return entries
    .filter((entry) =>
      roadmaps.some(
        (r) =>
          r.id === entry.roadmapId &&
          r.organizationId === org &&
          r.relationshipId === entry.relationshipId &&
          (r.prospectId ?? null) === entry.prospectId,
      ),
    )
    .map((entry) => ({
      slug: entry.slug,
      roadmapId: entry.roadmapId,
      organizationId: org,
      reviewedBy: "Tai-approved canonical batch",
      reviewedAt: "2026-11-03T18:25:22.418683Z",
    }));
}
