import { useState } from "react";

export function useAuthForm(initialFormData) {
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState(initialFormData);

  const handleChange = (evt) => {
    setMessage("");
    setFormData((prev) => ({ ...prev, [evt.target.name]: evt.target.value }));
  };

  return {
    message,
    setMessage,
    formData,
    setFormData,
    handleChange,
  };
}
