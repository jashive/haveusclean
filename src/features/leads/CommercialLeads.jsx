import React, { useMemo, useState } from "react";
import CommercialLeadsToolbar from "./CommercialLeadsToolbar";
import CommercialLeadCard from "./CommercialLeadCard";
import CommercialLeadFormFields from "./CommercialLeadFormFields";
import CommercialProposalModalContent from "./CommercialProposalModalContent";
import CommercialEmailModalContent from "./CommercialEmailModalContent";
import {
  buildCommercialProposalEmail,
  createCommercialJobFromLead,
  createCommercialLeadFromForm,
  getEmptyCommercialLeadForm,
  markCommercialLeadBooked,
  markCommercialLeadPaid,
  markCommercialLeadQuoted,
} from "./commercialLeadActions";

export default function CommercialLeads({
  jobs,
  setJobs,
  partners,
  region,
  runtime,
}) {
  const {
    C,
    S,
    ModalComponent,
    QuoteBoxComponent,
    calculateQuote,
    COM_ADDONS,
    COM_SERVICE_COST_PER_SQFT,
    COM_FREQ_DISCOUNTS,
    BRAND,
    PARTNER_COST_PER_HOUR,
    LEAD_MOBILE_ACTIONS_ROW,
    LEAD_MOBILE_ACTION_BTN,
    markupFactor,
  } = runtime;
  const [leads, setLeads] = useState([
    { id:1, bizName:"Apex Financial Group", contactName:"Linda Torres", email:"ltorres@apexfin.com", phone:"555-8801", address:"1200 Commerce Blvd, Suite 400", serviceType:"Office Clean",        sqft:4500, floors:2, addons:["restrooms","supply"], frequency:"Weekly",    preferredDate:"2026-04-14", preferredTime:"6:00 AM", contractMonths:12, notes:"After-hours only.", status:"quoted", workOrder:null, paymentConfirmed:false },
    { id:2, bizName:"FitZone Gym",          contactName:"Derek Nolan",  email:"derek@fitzone.com",  phone:"555-7720", address:"300 Athletic Way",                serviceType:"Retail / Showroom", sqft:8000, floors:1, addons:["disinfect","carpet_com"], frequency:"Daily", preferredDate:"2026-04-07", preferredTime:"5:00 AM", contractMonths:6,  notes:"High traffic. Locker rooms priority.", status:"new", workOrder:null, paymentConfirmed:false },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [viewLead, setViewLead] = useState(null);
  const [showEmail, setShowEmail] = useState(null);
  const [form, setForm] = useState(getEmptyCommercialLeadForm());

  const leadQuotes = useMemo(() => {
    const byLeadId = new Map();
    for (const lead of leads) {
      const leadKey = String(lead?.id ?? "");
      try {
        byLeadId.set(leadKey, calculateQuote({ type:"commercial", data: lead, region }));
      } catch {
        byLeadId.set(leadKey, { total: 0, profit: 0, margin: 0, monthly: 0, contract: 0 });
      }
    }
    return byLeadId;
  }, [leads, region, calculateQuote]);

  const monthlyValue = useMemo(
    () => leads
      .filter((lead) => lead.status !== "new")
      .reduce((sum, lead) => sum + (leadQuotes.get(String(lead.id))?.monthly || 0), 0),
    [leadQuotes, leads],
  );

  const activeContractsCount = useMemo(
    () => leads.filter((lead) => ["booked", "paid"].includes(lead.status)).length,
    [leads],
  );

  const formQuote = useMemo(() => {
    if (!form.bizName) return null;
    try {
      return calculateQuote({ type:"commercial", data: form, region });
    } catch {
      return null;
    }
  }, [form, region, calculateQuote]);

  const viewLeadQuote = useMemo(() => {
    if (!viewLead) return null;
    try {
      return calculateQuote({ type:"commercial", data: viewLead, region });
    } catch {
      return null;
    }
  }, [region, viewLead, calculateQuote]);

  const sendQuote = (lead) => {
    const q = calculateQuote({ type:"commercial", data: lead, region });
    const { subject, body } = buildCommercialProposalEmail({
      lead,
      quote: q,
      brand: BRAND,
      region,
      commercialAddons: COM_ADDONS,
    });

    setLeads((ls) => markCommercialLeadQuoted(ls, lead.id));
    if (viewLead?.id === lead.id) setViewLead((v) => ({ ...v, status:"quoted" }));
    setShowEmail({ lead, q, subject, body, isCommercial: true });
  };

  const bookLead = (lead) => {
    const q = calculateQuote({ type:"commercial", data: lead, region });
    const newJob = createCommercialJobFromLead({
      lead,
      quote: q,
      partners,
      partnerCostPerHour: PARTNER_COST_PER_HOUR,
      commercialAddons: COM_ADDONS,
    });
    setJobs((js) => [...js, newJob]);
    setLeads((ls) => markCommercialLeadBooked(ls, lead.id, newJob.id));
    if (viewLead?.id === lead.id) setViewLead({ ...viewLead, status:"booked" });
    alert("✅ Commercial contract created! Work order added to Jobs.");
  };

  const confirmPayment = (lead) => {
    setLeads((ls) => markCommercialLeadPaid(ls, lead.id));
    if (viewLead?.id === lead.id) setViewLead({ ...viewLead, status:"paid", paymentConfirmed:true });
  };

  const submitForm = () => {
    setLeads((ls) => [...ls, createCommercialLeadFromForm(form)]);
    setShowForm(false);
    setForm(getEmptyCommercialLeadForm());
  };

  const toggleAddon = (id) => setForm((f) => ({
    ...f,
    addons: (f.addons || []).includes(id) ? (f.addons || []).filter((x) => x !== id) : [...f.addons, id],
  }));

  return (
    <div>
      <CommercialLeadsToolbar
        S={S}
        leadsCount={leads.length}
        monthlyValue={monthlyValue}
        activeContractsCount={activeContractsCount}
        C={C}
        onNewLead={() => setShowForm(true)}
      />
      <div style={S.divider} />
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {leads.map((lead) => {
          const q = leadQuotes.get(String(lead.id)) || { total: 0, profit: 0, margin: 0, monthly: 0, contract: 0 };
          return (
            <CommercialLeadCard
              key={lead.id}
              lead={lead}
              q={q}
              C={C}
              S={S}
              COM_ADDONS={COM_ADDONS}
              actionRowStyle={LEAD_MOBILE_ACTIONS_ROW}
              actionButtonStyle={LEAD_MOBILE_ACTION_BTN}
              onView={() => setViewLead(lead)}
              onSendQuote={() => sendQuote(lead)}
              onBook={() => bookLead(lead)}
              onConfirmPayment={() => confirmPayment(lead)}
            />
          );
        })}
      </div>

      {showForm && (
        <ModalComponent title="🏢 New Commercial Lead" onClose={() => setShowForm(false)} wide>
          <CommercialLeadFormFields
            S={S}
            C={C}
            form={form}
            setForm={setForm}
            COM_SERVICE_COST_PER_SQFT={COM_SERVICE_COST_PER_SQFT}
            COM_FREQ_DISCOUNTS={COM_FREQ_DISCOUNTS}
            COM_ADDONS={COM_ADDONS}
            toggleAddon={toggleAddon}
            markupFactor={markupFactor}
            formQuote={formQuote}
            QuoteBoxComponent={QuoteBoxComponent}
            submitForm={submitForm}
          />
        </ModalComponent>
      )}

      {viewLead && (
        <ModalComponent title={`📑 Proposal — ${viewLead.bizName}`} onClose={() => setViewLead(null)} wide>
          <CommercialProposalModalContent
            viewLead={viewLead}
            viewLeadQuote={viewLeadQuote}
            C={C}
            S={S}
            QuoteBoxComponent={QuoteBoxComponent}
            onSendQuote={() => sendQuote(viewLead)}
            onBook={() => bookLead(viewLead)}
            onConfirmPayment={() => confirmPayment(viewLead)}
          />
        </ModalComponent>
      )}

      {showEmail && (
        <ModalComponent title="📧 Send Commercial Proposal" onClose={() => setShowEmail(null)} wide>
          <CommercialEmailModalContent
            showEmail={showEmail}
            C={C}
            S={S}
            onCopyBody={() => {
              navigator.clipboard?.writeText(showEmail.body);
              alert("✅ Proposal copied to clipboard!");
            }}
          />
        </ModalComponent>
      )}
    </div>
  );
}
