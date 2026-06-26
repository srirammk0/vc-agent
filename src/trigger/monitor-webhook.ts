import { task } from "@trigger.dev/sdk/v3";
import { triage, qualify, scoreCompany } from "../../lib/gemini.js";
import { getSeenUrls, getShortlistContext, addSeenUrls, addPassedCompany, addRejectedCompany, logRun, updateSignal } from "../../lib/brain.js";
import { passesHardFilters } from "../../lib/filters.js";
import { linkup } from "../../lib/linkup.js";
import { runExaCompanySearch, runExaPeopleSearch } from "../../lib/exa.js";
import { sendRealtimeAlert } from "../../lib/email.js";
import { ParallelWebhookPayload } from "../../lib/types.js";

export const monitorWebhookHandler = task({
  id: "monitor-webhook-handler",
  maxDuration: 120,
  run: async (payload: ParallelWebhookPayload) => {
    const seenUrlsSet = await getSeenUrls();
    const seenUrlsArr = Array.from(seenUrlsSet);
    
    // Step 1: Triage
    const triageRes = await triage(JSON.stringify(payload), seenUrlsArr.join('\n'));
    if (!triageRes.worth_pursuing || triageRes.already_seen) {
      await logRun(payload.source, 0, `triaged out - ${triageRes.reason}`);
      await updateSignal(payload.source, "1 trigger fired, 0 passed (triaged out)");
      if (triageRes.company_url && !seenUrlsSet.has(triageRes.company_url)) {
          await addSeenUrls([triageRes.company_url]);
      }
      return;
    }

    const companyUrl = triageRes.company_url;
    if (companyUrl && seenUrlsSet.has(companyUrl)) {
       return;
    }
    
    // Step 2: Hard filter
    if (!passesHardFilters(payload.content)) {
      await logRun(payload.source, 0, "failed hard filters");
      if (companyUrl) await addSeenUrls([companyUrl]);
      return;
    }

    const companyName = triageRes.company_name || "Unknown Startup";

    // Step 3: Linkup Background Research
    const research1 = await linkup.search({
      query: `${companyName} AI startup product funding team`,
      depth: "standard",
      outputType: "searchResults"
    });
    
    let researchContext = JSON.stringify(research1.results);
    
    // Step 4: Qualify
    const shortlist = await getShortlistContext();
    const qualifyRes = await qualify(payload.content, researchContext, shortlist);
    
    if (!qualifyRes.qualifies) {
      if (companyUrl) {
         await addRejectedCompany(companyUrl, 0, `failed qualify: ${qualifyRes.reason}`);
      }
      await logRun(payload.source, 0, "failed qualification");
      return;
    }

    // Step 5: Exa Enrichment
    let metadata: any = {};
    let foundersList: any[] = [];
    if (qualifyRes.worth_exa_enrichment) {
      const companyRes = await runExaCompanySearch(companyName);
      if (companyRes.length > 0) {
        metadata = companyRes[0];
        if (!passesHardFilters("", metadata)) {
            await logRun(payload.source, 0, "failed hard filters after Exa");
            if (companyUrl || metadata.url) await addSeenUrls([companyUrl || metadata.url]);
            return;
        }
      }
      foundersList = await runExaPeopleSearch(companyName);
    } else {
        metadata.url = companyUrl;
    }

    // Step 6: Score
    const scoreInput = {
      companyName: companyName,
      websiteUrl: metadata.url || companyUrl,
      foundedYear: metadata.foundedYear,
      fundingStage: metadata.fundingStage,
      fundingTotal: metadata.fundingTotal,
      workforce: metadata.workforce,
      headquarters: metadata.headquarters,
      isYC: researchContext.toLowerCase().includes("y combinator") || payload.content.toLowerCase().includes("y combinator"),
      productSummary: researchContext,
      foundersList: JSON.stringify(foundersList),
      negativeSignals: ""
    };
    
    const scoreRes = await scoreCompany(scoreInput, shortlist, `Triggered by ${payload.source} monitor webhook.`);

    // Step 7: Write to Brain
    if (scoreRes.pass) {
      const fullCompany = {
        ...scoreRes,
        url: scoreInput.websiteUrl,
        foundedYear: scoreInput.foundedYear,
        fundingStage: scoreInput.fundingStage,
        fundingTotal: scoreInput.fundingTotal,
        workforce: scoreInput.workforce,
        headquarters: scoreInput.headquarters,
        founders: foundersList
      };
      await addPassedCompany(fullCompany);
      await logRun(payload.source, 1, `passed:${scoreRes.overall_score}`);
      await updateSignal(payload.source, "1 trigger fired, 1 passed");
      
      // Step 8: Email
      await sendRealtimeAlert(fullCompany, payload.source);
    } else {
      await addRejectedCompany(scoreInput.websiteUrl, scoreRes.overall_score, "failed scoring");
      await logRun(payload.source, 0, `failed scoring:${scoreRes.overall_score}`);
      await updateSignal(payload.source, "1 trigger fired, 0 passed (failed scoring)");
    }
  }
});
