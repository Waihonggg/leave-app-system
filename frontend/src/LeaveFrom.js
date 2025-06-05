import React, { useState } from "react";

function LeaveForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    leaveType: "",
    startDate: "",
    endDate: "",
    reason: ""
  });
  const [status, setStatus] = useState("");

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setStatus("Submitting...");
    const res = await fetch("http://localhost:3001/api/apply-leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const data = await res.json();
    if (data.success) {
      setStatus("Leave application submitted!");
      setForm({ name: "", email: "", leaveType: "", startDate: "", endDate: "", reason: "" });
    } else {
      setStatus(data.error || "Failed to submit.");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{maxWidth: 400}}>
      <input name="name" placeholder="Name" value={form.name} onChange={handleChange} required /><br/>
      <input name="email" type="email" placeholder="Email" value={form.email} onChange={handleChange} required /><br/>
      <input name="leaveType" placeholder="Leave Type" value={form.leaveType} onChange={handleChange} required /><br/>
      <input name="startDate" type="date" value={form.startDate} onChange={handleChange} required /><br/>
      <input name="endDate" type="date" value={form.endDate} onChange={handleChange} required /><br/>
      <textarea name="reason" placeholder="Reason" value={form.reason} onChange={handleChange} required /><br/>
      <button type="submit">Apply</button>
      <div style={{marginTop: 10}}>{status}</div>
    </form>
  );
}

export default LeaveForm;
