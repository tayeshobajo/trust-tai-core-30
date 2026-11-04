/** Scoped public DOM observation, 2026-11-03: existing 39 plus four references
 * needed for the seven approved canonical bindings. The broader 59-page inventory
 * is separate reconciliation work; this list is not a complete directory total.
 * Publication is not delivery or a canonical binding.
 * Refresh through a reviewed source observation; never interpret absent entries as deletions. */
export const publicRoadmapObservation = {
  checkedAt: "2026-11-03T21:43:23Z",
  sourceUrl: "https://trusttai.com/clients",
  entries: [
    ["teamsynerg", "TeamsynerG"],
    ["lester", "Lester Estate Wines"],
    ["trubee-honey", "TruBee Honey"],
    ["real-leaders", "Real Leaders"],
    ["spartan", "Spartan Security Services"],
    ["rollick", "Rollick"],
    ["epay", "ePayPolicy"],
    ["pttanywhere", "PTT Anywhere"],
    ["shugarshack", "Shugar Shack"],
    ["elevate", "Elevate Orthodontics"],
    ["jd-genius", "JDGenius"],
    ["sase", "SASE"],
    ["sbrc", "Santa Barbara Reading Coalition"],
    ["smartsoft", "SmartSoft"],
    ["sherri-clarke", "Sherri Clarke Nutrition"],
    ["rejuvenate", "Rejuvenate Health & Wellness"],
    ["classy-cactus-farm", "Classy Cactus Farm"],
    ["crenshaw-landscaping", "Crenshaw Landscaping"],
    ["360-tax-solutions", "360 Tax Solutions"],
    ["sanders-brothers", "Sanders Bros. Coffee"],
    ["noble-springs-dairy", "Noble Springs Dairy"],
    ["lookout-bookkeeping", "Lookout Bookkeeping"],
    ["the-chattery", "The Chattery"],
    ["pop-up-project-studio34", "The Pop-up Project / Studio34"],
    ["mud-puddle", "Mud Puddle Pottery Studio & Art Gallery"],
    ["dreamscapes", "Dreamscapes LLC"],
    ["kpayne-contracting", "K.Payne Contracting, LLC"],
    ["hales-window-cleaning", "Hale’s Window Cleaning Service"],
    ["nashville-cleaning-company", "Nashville Cleaning Company"],
    ["terry-woodall-roofing", "Terry Woodall Roofing Contractors"],
    ["bradley-inspection", "Bradley Inspection Services, LLC"],
    ["ta-bookkeeping", "TA Bookkeeping Services, LLC"],
    ["startup-your-hr", "Startup Your HR"],
    ["e-nash-associates", "E. Nash Associates"],
    ["highview", "Highview Leadership Group"],
    ["moxie", "MOXIE Nashville"],
    ["olive-sinclair", "Olive & Sinclair"],
    ["sequatchie", "Sequatchie Cove Creamery"],
    ["ryan-partners", "Ryan Partners"],
    ["nashville-glasshaus", "Nashville Glasshaüs"],
    ["turnip-green", "Turnip Green Creative Reuse"],
    ["littlebranch-farm", "Littlebranch Farm"],
    ["one-chance-bookkeeping", "One Chance Bookkeeping"],
  ].map(([slug, name]) => ({
    slug: slug!,
    name: name!,
    url: `https://trusttai.com/clients/${slug}`,
    ...(slug === "smartsoft"
      ? {
          identityHold:
            "Identity conflict: the published greeting disagrees with reviewed correspondence. Confirm the business and contact before linking; do not merge from the greeting.",
        }
      : {}),
  })),
};
