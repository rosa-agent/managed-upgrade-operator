package preflight

import (
	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("validateCheckRequest", func() {
	baseReq := func() CheckRequest {
		return CheckRequest{
			TargetVersion: "4.14.11",
			TargetChannel: "stable-4.14",
			Platform:      "OSD",
		}
	}

	It("passes a valid minimal request", func() {
		Expect(validateCheckRequest(baseReq())).To(Succeed())
	})

	It("fails when targetVersion is empty", func() {
		req := baseReq()
		req.TargetVersion = ""
		Expect(validateCheckRequest(req)).To(HaveOccurred())
	})

	It("fails when targetChannel is empty", func() {
		req := baseReq()
		req.TargetChannel = ""
		Expect(validateCheckRequest(req)).To(HaveOccurred())
	})

	It("fails when platform is not OSD or ARO", func() {
		req := baseReq()
		req.Platform = "GKE"
		Expect(validateCheckRequest(req)).To(HaveOccurred())
	})

	It("accepts ARO as a valid platform", func() {
		req := baseReq()
		req.Platform = "ARO"
		Expect(validateCheckRequest(req)).To(Succeed())
	})

	It("fails when DefaultCheckTimeoutSeconds is negative", func() {
		req := baseReq()
		req.DefaultCheckTimeoutSeconds = -1
		err := validateCheckRequest(req)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("defaultCheckTimeoutSeconds"))
	})

	It("accepts zero DefaultCheckTimeoutSeconds (uses framework default)", func() {
		req := baseReq()
		req.DefaultCheckTimeoutSeconds = 0
		Expect(validateCheckRequest(req)).To(Succeed())
	})

	It("fails when OverallTimeoutSeconds is negative", func() {
		req := baseReq()
		req.OverallTimeoutSeconds = -1
		err := validateCheckRequest(req)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("overallTimeoutSeconds"))
	})

	It("accepts zero OverallTimeoutSeconds (no overall deadline)", func() {
		req := baseReq()
		req.OverallTimeoutSeconds = 0
		Expect(validateCheckRequest(req)).To(Succeed())
	})

	It("fails when checksToRun contains an unknown check name", func() {
		req := baseReq()
		req.ChecksToRun = []string{"ClusterVersion", "NonExistentCheck"}
		err := validateCheckRequest(req)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("NonExistentCheck"))
		Expect(err.Error()).To(ContainSubstring("unknown check name"))
	})

	It("passes when checksToRun contains only valid check names", func() {
		req := baseReq()
		req.ChecksToRun = []string{"ClusterVersion", "UpgradeTarget"}
		Expect(validateCheckRequest(req)).To(Succeed())
	})

	It("passes when checksToRun is empty (run all checks)", func() {
		req := baseReq()
		req.ChecksToRun = nil
		Expect(validateCheckRequest(req)).To(Succeed())
	})
})

var _ = Describe("handleCatalog", func() {
	It("returns all registered checks with name, description, owner", func() {
		entries := make([]CatalogEntry, 0, len(registeredChecks))
		for _, c := range registeredChecks {
			entry := CatalogEntry{
				Name:        c.Name(),
				Description: c.Description(),
				Owner:       string(c.DefaultOwner()),
			}
			if t := c.DefaultTimeout(); t > 0 {
				entry.TimeoutSecs = int(t.Seconds())
			}
			entries = append(entries, entry)
		}
		Expect(entries).To(HaveLen(len(registeredChecks)))
		for _, e := range entries {
			Expect(e.Name).NotTo(BeEmpty())
			Expect(e.Description).NotTo(BeEmpty())
			Expect(e.Owner).NotTo(BeEmpty())
		}
	})

	It("includes UpgradeTarget in the catalog", func() {
		names := make([]string, 0, len(registeredChecks))
		for _, c := range registeredChecks {
			names = append(names, c.Name())
		}
		Expect(names).To(ContainElements("UpgradeTarget", "ClusterOperators", "CriticalAlerts"))
	})
})
