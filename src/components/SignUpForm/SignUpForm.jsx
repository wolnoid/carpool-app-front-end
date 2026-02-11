import { useContext } from "react";
import { useNavigate } from "react-router";
import { signUp } from "../../services/authService";
import { UserContext } from "../../contexts/UserContext";
import SignUpIcon from "../../assets/images/signup.svg";
import styles from "./SignUpForm.module.css";
import { useAuthForm } from "../../hooks/useAuthForm";
import AuthFormShell from "../AuthFormShell/AuthFormShell";

const SignUpForm = () => {
  const navigate = useNavigate();
  const { setUser } = useContext(UserContext);
  const { message, setMessage, formData, handleChange } = useAuthForm({
    username: "",
    password: "",
    passwordConf: "",
  });

  const { username, password, passwordConf } = formData;

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    try {
      const newUser = await signUp(formData);
      setUser(newUser);
      navigate("/");
    } catch (err) {
      setMessage(err.message);
    }
  };

  const isFormInvalid = () => {
    return !(username && password && password === passwordConf);
  };

  return (
    <AuthFormShell
      className={styles.container}
      iconSrc={SignUpIcon}
      iconAlt="An owl sitting on a sign"
      title="Sign Up"
      message={message}
      onSubmit={handleSubmit}
      autoComplete="on"
    >
      <div>
        <label htmlFor="username">Username:</label>
        <input
          type="text"
          id="username"
          value={username}
          name="username"
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <label htmlFor="password">Password:</label>
        <input
          type="password"
          id="password"
          value={password}
          name="password"
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <label htmlFor="confirm">Confirm Password:</label>
        <input
          type="password"
          id="confirm"
          value={passwordConf}
          name="passwordConf"
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <button disabled={isFormInvalid()}>Sign Up</button>
        <button type="button" onClick={() => navigate("/")}>
          Cancel
        </button>
      </div>
    </AuthFormShell>
  );
};

export default SignUpForm;
