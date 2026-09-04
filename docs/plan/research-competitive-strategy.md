# Build Plan, Competitive Map, SWOT & Porter's Five Forces for a "Cheapest-Price" Anti-Surveillance-Pricing Shopping Platform (US-First)

## TL;DR
- **Build the panel first, the storefront second.** The defensible moat is not coupon aggregation — a crowded, commoditized, affiliate-conflicted space dominated by Capital One Shopping, Rakuten (17M+ US members), Honey, Slickdeals, and Ibotta — but a consented user panel that passively observes retailers' randomized price experiments and reconstructs the full price distribution. No incumbent does this, and individual shoppers mathematically cannot do it alone because bucket assignment is hash-stable per user.
- **The regulatory moment is the wedge.** The FTC surveillance-pricing staff report (released Jan 17, 2025, approved 3–2, from July 2024 6(b) orders to Mastercard, Revionics, Bloomreach, JPMorgan Chase, Task Software, PROS, Accenture, and McKinsey & Co.); the Consumer Reports/Groundwork Collaborative/More Perfect Union Instacart investigation (Dec 2025); NY's Algorithmic Pricing Disclosure Act (effective Nov 10, 2025); and the proposed FTC enforcement policy statement (Aug 2026) together create demand, distribution (press/AG partners), and a data-licensing revenue line no pure-affiliate competitor can match. Public appetite is strong: EPIC cites a January 2025 survey in which **76% of Americans opposed** using personal data to set individualized prices.
- **Sequence to defer the hardest problems.** Phase 1: browser extension + panel + price-distribution display on 3–5 high-variance retailers (Instacart, Amazon, Target, Walmart, Safeway/Albertsons). Phase 2: basket-level multi-retailer optimization and compliance-detection/AG-complaint tooling. Phase 3: data licensing (AGs, researchers, press) and a B2B "price-truth" API. Affiliate revenue funds the lights but must be walled off from ranking to keep the "genuinely cheapest" promise credible.

## Key Findings

**1. The incumbents are structurally conflicted, and none show a price distribution.** Every major "savings" player monetizes affiliate commissions, creating a direct conflict with showing the genuinely cheapest price: the platform earns when you buy through its link, not when you pay the least. Honey's ~$4B PayPal-era model collapsed into 25+ consolidated class actions (*In re PayPal Honey Browser Extension Litigation*, N.D. Cal.) over "cookie stuffing" — swapping creators' affiliate tags for its own. The case was dismissed Nov 21, 2025 (Judge Beth Labson Freeman, on standing/injury grounds), but plaintiffs filed a strengthened 101-page second amended complaint and it remains active as of mid-2026. GamersNexus alleged its affiliate revenue fell from ~$161,600 to ~$52,700. This is the single most important cautionary tale for monetization design.

**2. Panel economics are favorable and quantifiable.** Using the coupon-collector's model (expected draws to see all *k* equally-likely buckets = k·H_k), to resolve **all 5 discrete price points** of an item you need **~11–12 observers on average, ~20–25 for 95% confidence** (equal tiers). To catch the *floor* shown to only a fraction *p* of shoppers you need **~3/p observers** (≈30 at p=10%, ≈60 at p=5%, ≈150 at p=2%). Detecting mere multiplicity (≥2 prices) is cheap: **~5 observers** if tiers are balanced, ~28 if the minority tier is only ~10%. The rarest/lowest tier dominates cost (scales as 1/p) — capturing the true floor is the expensive part.

**3. The Groundwork/CR study is your density benchmark.** Across 5 controlled tests (Sept 2025) with 437 volunteers, 193 cleaned datasets were analyzed — effectively **~30–40 panelists per SKU-store-time cell**, comfortably above the ~23-observer threshold needed to resolve 5 tiers. That is your concrete minimum-viable panel density. Per Groundwork's "Same Cart, Different Price: Instacart's Price Experiments Cost Families at Checkout": *"nearly 75 percent of the grocery items were shown at multiple prices, with as many as five different prices for one product. On average, the difference between the highest and lowest price was 13%, while the largest differential for a single item was 23%."* Basket totals varied *"by an average of about 7%,"* costing *"a household of four… roughly an extra $1,200 per year."* A confirmation test (88 volunteers, Nov 2025) found similar experimentation at Albertsons, Costco, Kroger, and Sprouts.

**4. Randomized assignment is exactly what makes a passive panel the right instrument.** Instacart confirmed customers are *"randomly assigned to price test cohorts by product category and location,"* running experiments through its Eversight subsidiary (acquired 2022) for a subset of ~10 retail partners. Because assignment is random and hash-stable per user (deterministic once observed, not regenerated per page load), an individual can't lever to the floor — but a panel draws i.i.d. samples from the retailer's price distribution, making the coupon-collector math directly applicable and the moat real.

**5. No incumbent measures counterfactual savings; all report gross/face-value or "up to" maxima.** Rakuten cites *"over $3.6 Billion in Cash Back"* paid since 1999; Ibotta cites cumulative cash back and inconsistent per-user averages ($150/$218/$256/$261 across its own properties); Flipp claims *"up to 20% weekly"* / *"$46/week."* None report incremental savings vs. what you'd have paid anyway. This is both a credibility opportunity and a regulatory minefield: Honey's "every working code on the internet" claim was discontinued after a 2020 NAD (BBB National Programs) challenge; the academic critique (Vana, Lambrecht & Bertini, "Cashback is Cash Forward," *Journal of Marketing Research* 2018) shows cash-back payments actively *increase* future spending — undercutting the "savings" narrative.

**6. Agentic commerce is arriving fast and reshapes the competitive frame.** ACP (OpenAI + Stripe, Sept 29, 2025), AP2 (Google, donated to FIDO Alliance), Google's UCP "Buy for Me," and Amazon's Rufus/Alexa-for-Shopping (300M+ users, ~$12B incremental sales) mean AI agents will mediate discovery and checkout. OpenAI wound down native Instant Checkout on March 24, 2026 after low volume — agents are strong at discovery, weak at trusted purchase completion. Position as the neutral "price truth" input to any agent rather than competing to own checkout.

## Details

### A. Competitor Mapping

**Coupon/cashback extensions (direct-ish, affiliate-funded):**
- **Capital One Shopping** (formerly Wikibuy): free extension embedded in Capital One's data-driven banking ecosystem; monetizes via affiliate commissions while strengthening card engagement. Not a standalone P&L — a customer-acquisition asset for a top-3 US card issuer (~19% card share post-Discover). Faced a class-action settlement (class period Jan 6, 2020–Dec 18, 2025) alleging improper receipt of affiliate commissions. **Response to a new entrant:** deep pockets, could copy features, but conflicted and slow; unlikely to attack surveillance-pricing transparency because it benefits from the affiliate status quo.
- **Rakuten (Ebates):** largest US cashback community — *"more than 17M active members"* (20M+ globally), 3,500+ stores, *"over $3.6 Billion in Cash Back"* paid since 1999. Rakuten acquired Ebates for $1B in 2014. Affiliate commission-share model requiring login/extension activation; Q2 2024 Rakuten Rewards operating income ~$10M. **Response:** entrenched and brand-trusted ("we do not sell your personal data to data brokers"), but cashback ≠ cheapest price; the deferred-spending model is vulnerable to a "true floor" narrative.
- **Honey (PayPal):** ~17M MAU at 2020 acquisition ($4B). Reputationally damaged post-MegaLag (Dec 2024). **Response:** in a legal/defensive crouch; the weakest incumbent to fear.
- **Slickdeals:** community-driven deal marketplace, ~$20.9M revenue, acquired by Goldman Sachs + Hearst (2018), ~157 employees, top-100 US site. **Response:** an enduring community moat; a potential partner/acquirer more than a head-on competitor.
- **RetailMeNot:** coupon directory, $200M–$500M revenue range, owned by Vericast (ex-Harland Clarke, acquired $630M in 2017). Declining relevance.
- **Karma, Cently/Coupons at Checkout, Wikibuy legacy, Klarna shopping tools, Microsoft Edge/Bing shopping, Google Shopping:** feature-level competitors on price tracking and coupon auto-apply. Google Shopping's price-insights/"track price" features are the most-used free tools by reach — but they show a single price/history, not a cross-user distribution.

**Amazon price trackers:**
- **Keepa:** tracks ~5.6B products across 11 marketplaces, hourly updates, ~4M Chrome users, ~$19/mo premium + API. **CamelCamelCamel:** free, since 2008 (Cosmic Shovel Inc.), ~800K extension users, no published watch cap; extension last updated June 2024 (maintenance risk). Both are single-seller *time-series* trackers (list price over time), **not** cross-user personalized-price detectors — the exact gap the panel fills. Closest conceptual model to "observed floor."

**Grocery-specific:**
- **Ibotta:** NYSE: IBTA, IPO April 2024 (~$198M raised); FY2024 revenue $367.3M, net income $68.7M (19% margin), 344.1M redemptions, IPN averaged 14.7M redeemers. Powers Walmart, Dollar General, Family Dollar, and Instacart rebate programs. Rebate/receipt-scan model, CPG-funded. **Response:** profitable and scaled, but tied to brand-funded rebates that induce switching, not net savings.
- **Flipp:** digital weekly-ad aggregator, 2,000+ stores, used by Kroger/Walmart; claims "save up to 20% weekly" / "average $46/week."
- **Fetch, Checkout 51, Shopkick, Upside ($1B+ paid), Receipt Hog:** receipt-scan rebate/loyalty apps. **Instacart itself / Shipt:** the surveillance-pricing *subject*, not a competitor to a transparency tool.

**Travel/price-variance tools:** Hopper (price prediction + fintech "price freeze"), Going/Scott's Cheap Flights (subscription flight-deal alerts), Kayak/ITA Matrix (metasearch). These prove consumers pay for price-variance intelligence and that a subscription model works in adjacent categories. *(Evidence thin — search budget exhausted before deep travel profiling; directional.)*

**VPNs marketed for shopping savings (Surfshark, NordVPN, PIA, Proton):** positioned as indirect substitutes for beating geographic/personalized pricing. Evidence that VPNs reliably yield cheaper retail/grocery prices is weak and inconsistent; they address location-based but not behavioral/hash-bucket personalization. *(Evidence thin — single-source/directional.)*

**Emerging AI shopping agents:** ChatGPT (~900M WAU, discovery-focused after retiring Instant Checkout March 24, 2026), Perplexity Shopping (free agentic checkout, PayPal Instant Buy, 5,000+ merchants; Amazon sued it Dec 2025), Amazon Rufus/Alexa-for-Shopping (300M+ users, ~$12B incremental sales, walled garden, now shows 30/90-day price history), Google AI Mode/UCP "Buy for Me" (Wayfair, Chewy, Walmart), Walmart Sparky. Standards: **ACP** (checkout), **AP2** (payment authorization mandates), **UCP** (full journey), **x402** (stablecoin M2M), Visa TAP. **Strategic read:** frenemies — a neutral price-distribution API is a natural input to agents and a hedge against any single walled garden.

**Surveillance-pricing transparency startups:** nascent. Industry commentary anticipates "a surge in 'Price Transparency' startups" and consumer "Counter-AI" tools, but no dominant named consumer entrant has emerged as of mid-2026 — a genuine first-mover window. *(Forward-looking secondary-source prediction, not a confirmed competitor.)*

**Watchdog/nonprofit analogues as PARTNERS (not competitors):** Consumer Reports ("Make the Price Right" / "Same Cart, Different Price"), Groundwork Collaborative, More Perfect Union, EPIC. These provide methodology, credibility, distribution, and a data-licensing customer base.

### B. Market & Mechanism Research (savings levers)
- **Coupon discovery/auto-apply:** Honey/Capital One source codes via partner feeds + crowdsourcing + scraping; success rates are modest and inconsistent (Honey's NAD-challenged "every working code" claim). Table stakes, low differentiation.
- **Affiliate/cashback economics:** median ecommerce affiliate commission ~8.4% of order value (SaaS ~22.5%, travel ~4.2%); Amazon Associates 1–3% for electronics with a 24-hour cookie; cookie windows are collapsing (38% of programs now ≤7 days post-ITP/ATT). **Core conflict:** affiliate revenue rewards conversion, not lowest price.
- **Price history/drop tracking & price protection:** Keepa/Camel model. Credit-card price protection has been largely discontinued by major issuers. *(Flag: needs current confirmation — search budget exhausted.)*
- **Other levers** (retailer price-match automation; loyalty/digital-coupon clipping; personalized-offer arbitrage; cart-abandonment triggers; subscribe-and-save; unit-price/store-brand substitution; regional/store-level variation; fulfillment-path arbitrage across pickup/delivery/ship-to-store fees; session-state levers such as logged-in/out, clean session, referrer, device/app vs. web; gift-card + portal + card-multiplier stacking): all real. The panel's unique contribution is empirically measuring which levers actually move the observed price.
- **Data sources/APIs:** **Datasembly** (billions of grocery/retail pricing records; 150,000+ stores, 200+ banners, 30,000+ zips; raised ~$35.5M; acquired by SPINS June 2025), **Numerator**, Wiser, Price2Spy, **Bright Data** (scraping infra), Zyte. Retailer APIs: Kroger, Walmart, Amazon Product Advertising API, **Instacart Developer Platform**, Google Shopping Content API. Critically, these give catalog/list prices, **not** per-user personalized prices — reinforcing that the panel is the only route to the personalized-price distribution.

### C. Legal & Risk (business-planning flags — engage counsel; not legal advice)
- **Scraping public price data:** *hiQ v. LinkedIn* and **Meta v. Bright Data** (N.D. Cal., summary judgment for Bright Data, Jan 23, 2024) confirm that **logged-off scraping of publicly available data** generally does not breach ToS or the CFAA (*Van Buren* narrowed CFAA). But the ruling is narrow: it does not make scraping per se legal, contract/trespass-to-chattels claims survive, and **logged-in** scraping (which personalized prices require) is a riskier posture. **Key risk area — counsel required.**
- **Storing retailer credentials / credentialed access:** the highest-risk technical choice. The financial-data-aggregation analogy (FINRA, CFPB, Bank Policy Institute warnings; CFPB Section 1033/open-banking push toward OAuth tokens over screen-scraping) shows regulators treat credential storage as the riskiest model. There is **no direct retail equivalent** of open-banking rules yet, but the direction favors token/OAuth and consented, user-driven observation. **Prefer client-side observation (the extension reads the price the user already sees) over server-side credentialed login.**
- **Consumer privacy (panel):** CCPA/CPRA plus a growing patchwork; California's **Delete Act/DROP** and **SB 361** (Oct 8, 2025) expand data-broker registration (fees rose from $400 in 2024 to $6,600 in 2025; $200/day non-registration penalty; DROP deletion requests processed from Aug 1, 2026). If you license data you may be a **data broker** — build consent, minimization, and DSAR/deletion from day one. Enforcement is active (Tractor Supply $1.35M; Honda $632,500; ROR $56,600).
- **FTC endorsement/affiliate disclosure:** if you earn commissions while claiming "cheapest price," you must disclose the conflict clearly and conspicuously and ensure ranking is not commission-driven — or face Section 5 deception exposure.
- **AG-complaint generation / UPL:** **DoNotPay** shows the twin risks. Per the FTC, its final order "requires DoNotPay to pay $193,000 in monetary relief and notify consumers who subscribed to the service between 2021 and 2023" over its "world's first robot lawyer" claims (complaint Sept 2024; final order early 2025). The *MillerKing v. DoNotPay* UPL suit was dismissed on standing. Mitigate both risks by framing your tool as a **self-help form-filler / evidence-packager** the user submits themselves, with no legal advice and heavy disclaimers.
- **Savings claims:** avoid Honey/DISH/SmileDirectClub/Monarch-style "up to X%" or survey-based figures (all struck by NAD). Ground any savings claim in control-group/counterfactual (incrementality) methodology.

### D. Business Model & Go-To-Market
- **Monetization ranked by conflict-of-interest safety:** (1) **Data licensing** to AGs, congressional staff, academics, journalists — cleanest, mission-aligned, unique to the panel; (2) **Subscription** (à la Going/Hopper) for power features (floor alerts, basket optimization, compliance reports); (3) **B2B API** (neutral price-truth feed to agents/retailers/researchers); (4) **Advertising** — risky for trust; (5) **Affiliate** — necessary bridge financing but walled off from ranking and fully disclosed.
- **Panel size needed:** minimum viable ~30–40 observers per SKU-store-time cell (Groundwork benchmark) to resolve up to 5 tiers; nationwide coverage requires tens of thousands of active panelists concentrated on high-velocity SKUs and high-variance retailers. Prioritize depth on a few retailers over breadth.
- **Cold start (two-sided data problem):** seed via (a) partnership with CR/Groundwork/MPU volunteer communities; (b) a "contribute your screenshot, see the ladder" reciprocity loop; (c) client-side passive collection so contribution is zero-effort; (d) launch on the single highest-variance, highest-outrage retailer (Instacart) to maximize press.
- **Distribution:** browser extension (desktop capture) + mobile app (in-store/app capture) + PWA; API integrations with agents later.
- **Precedents:** consumer data-cooperative and data-trust models provide the governance template (members own/govern the data; the platform stewards it) — reinforcing trust and differentiating from data-broker incumbents.

### E. Savings-Demonstration / Receipt Layer
Existing players report **gross/face-value or cumulative** savings ("$3.6B paid," "up to 20%," "average $256/yr") — never **counterfactual** savings (what you'd have paid anyway). To prove real savings and stay out of NAD/FTC trouble, adopt **incrementality measurement**: control/holdout groups, geo-tests (Meta's open-source GeoLift), matched baskets, and "observed floor vs. price paid" deltas grounded in actual panel observations. Cite the Groundwork methodology as your public benchmark. The concept to own: **"we show you the true floor and the true counterfactual, not a coupon's face value."** Note the irony that Eversight — Instacart's price-testing engine — is itself the canonical incrementality vendor; the same math that lets retailers hide savings lets you verify them.

### Prioritized Levers (value per unit of engineering effort, ranked)
1. **Price-distribution/ladder display on high-variance retailers** — highest value, moderate effort. The core differentiator.
2. **Client-side passive price capture (extension/app)** — the enabler for everything; build once.
3. **Basket-level multi-retailer optimization (assignment problem incl. fees)** — high value, high effort; defer to Phase 2.
4. **Compliance detection + one-click AG-complaint packager** — moderate value/effort, huge PR and moat value; Phase 2.
5. **Coupon auto-apply / cashback stacking** — low differentiation (commoditized); integrate via partners, don't build from scratch.
6. **Price-drop/history alerts** — low effort, low differentiation (Keepa/Camel exist); cheap table stakes.
7. **Fulfillment-path & session-state levers** — moderate value, low effort once capture exists; good "quick win" content.
8. **Data-licensing productization** — high value, low incremental effort once the panel exists; Phase 3.

## SWOT
**Strengths:** unique panel-based price-distribution moat individuals can't replicate; regulatory tailwind and press/AG distribution; mission-aligned trust position vs. conflicted incumbents; multiple non-affiliate revenue lines; first-mover in a nascent transparency category.

**Weaknesses:** two-sided cold-start (need users for data, data for users); credential/scraping legal exposure if done server-side; hard to make defensible savings claims without rigorous counterfactual measurement; no affiliate war-chest vs. Capital One/Rakuten; panel density expensive to reach nationwide.

**Opportunities:** data licensing to AGs/researchers/press; neutral price-truth API for AI agents (ACP/AP2/UCP era); partnerships with CR/Groundwork/EPIC; expansion from grocery (highest outrage) to travel/retail; regulatory mandates (NY disclosure law) that force retailers to expose data you can verify.

**Threats:** retailers blocking capture (Amazon sued Perplexity and blocks agent crawling); walled gardens (Amazon Rufus) foreclosing observation; incumbents copying the distribution display; privacy/data-broker regulation hitting your own panel; agentic checkout disintermediating comparison entirely; retailers simply *stopping* experiments (Instacart halted item price tests Dec 22, 2025 after an FTC civil investigative demand, and separately agreed to a $60M FTC settlement) — which removes the very data your panel feeds on.

## Porter's Five Forces
- **Threat of new entrants: MODERATE-HIGH.** Coupon/cashback is easy to copy; the panel moat is hard (scale + trust + methodology). Regulatory attention lowers barriers to *press-driven* entry but raises them for *data* entry.
- **Bargaining power of suppliers (data sources/retailers): HIGH.** Retailers can block capture, change layouts, sue over ToS, or wall off (Amazon). Mitigate with client-side/logged-off capture and diversified retailer coverage.
- **Bargaining power of buyers (users): MODERATE.** Consumers are price-sensitive and multi-home (Rakuten + Ibotta + Camel simultaneously); switching costs are low, so retention depends on unique data value, not lock-in.
- **Threat of substitutes: HIGH.** VPNs, AI shopping agents, existing trackers, and simply "shop logged out" all substitute partially; agents may absorb the comparison function.
- **Competitive rivalry: HIGH in coupons/cashback, LOW in price-distribution transparency.** Choose the low-rivalry lane.

## Recommendations

**Phase 0 (0–3 months) — De-risk legal & seed data:**
- Engage counsel on scraping posture, credential handling, data-broker status, and UPL *before* writing capture code. **Decision benchmark:** if counsel flags server-side credentialed login as high-risk, commit fully to **client-side passive capture only**.
- Sign an MOU with CR/Groundwork/More Perfect Union for methodology + volunteer seeding.

**Phase 1 (3–9 months) — Panel + distribution display:**
- Ship a browser extension + mobile app that passively captures the price the user already sees on 3–5 high-variance retailers (Instacart first, then Amazon/Target/Walmart/Safeway).
- Build the price-ladder UI (show the distribution + floor, not a single number). Target ≥30–40 observers per priority SKU-store-time cell.
- Monetize only via disclosed, ranking-independent affiliate + a free tier. **Benchmark to advance:** 25,000+ active panelists and reliable 5-tier resolution on top-500 grocery SKUs in 3 launch metros.

**Phase 2 (9–18 months) — Optimization + compliance/AG tooling + subscription:**
- Ship the basket-level multi-retailer optimizer (assignment problem incl. fees/memberships/fulfillment path).
- Ship compliance-detection + a self-help AG-complaint packager (user-submitted, no legal advice, DoNotPay guardrails).
- Launch a subscription for floor alerts + compliance reports. **Benchmark:** verifiable counterfactual-savings reporting (control-group methodology) before any public savings claim.

**Phase 3 (18–30 months) — Data licensing + API:**
- Productize the dataset for AGs, academics, journalists; ship a neutral price-truth API for agents. Register as a data broker if licensing triggers it. **Benchmark to scale nationally:** panel density sufficient for 95%-confidence floor detection (≈3/p observers) on priority SKUs in 10+ metros.

**Thresholds that would change the plan:**
- If a well-funded incumbent (Capital One, Google) ships a distribution display → pivot to the data-licensing/API and compliance lanes, where neutrality is harder to copy.
- If retailers broadly block client-side capture → shift to a co-op model with explicit user-submitted screenshots (the Groundwork model).
- If agentic checkout consolidates faster than expected → prioritize the API-to-agents position over the consumer storefront.
- If retailers broadly *stop* running price experiments in response to regulation → pivot the value prop from "detect hidden variance" to "verify compliance and certify one-price integrity," and lean harder on the conventional-discount levers.

## Caveats
- Travel-tool profiles, VPN-savings efficacy, and credit-card price-protection status are thinly sourced (search budget exhausted before deep coverage) — treat as directional and verify.
- The "surveillance-pricing transparency startup surge" is a forward-looking secondary-source prediction, not confirmed competitors.
- Honey/Capital One affiliate-diversion specifics are largely litigation *allegations* (not adjudicated); the firmest primary sources are the NAD Honey decision and the settlement class definitions.
- Coupon-collector 95%-confidence thresholds assume i.i.d. random assignment (Instacart-confirmed); real experiments with unequal or serially-correlated assignment need more observers — treat these as lower bounds.
- Instacart ended item price tests Dec 22, 2025 after an FTC civil investigative demand (per Consumer Reports, "Instacart has stopped offering technology that allowed grocery retailers to charge shoppers different prices for the same groceries at the same time") and separately agreed to a $60M FTC settlement over deceptive fee/delivery practices. A retailer's ability to simply stop testing is a genuine, material threat to the panel's data supply and must be continuously monitored.
- This is business planning, not legal advice; the flagged legal areas require qualified counsel.