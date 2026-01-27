import { useEffect, useState } from "react";
import api from "../api/axios";

function Profile() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/auth/me")
      .then((res) => {
        setUser(res.data.user);
      })
      .catch(() => {
        setError("Unauthorized or token expired");
      });
  }, []);

  if (error) return <p>{error}</p>;
  if (!user) return <p>Loading profile...</p>;

  return (
    <div style={{ maxWidth: "400px", margin: "40px auto" }}>
      <h2>Profile</h2>
      <p><b>Name:</b> {user.name}</p>
      <p><b>Email:</b> {user.email}</p>
    </div>
  );
}

export default Profile;
