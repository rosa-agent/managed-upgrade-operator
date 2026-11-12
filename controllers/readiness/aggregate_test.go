package readiness

import (
	upgradev1alpha1 "github.com/openshift/managed-upgrade-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("applyAggregates", func() {
	now := metav1.Now()

	makeChecks := func(results ...upgradev1alpha1.CheckResult) []upgradev1alpha1.ReadinessCheckResult {
		checks := make([]upgradev1alpha1.ReadinessCheckResult, len(results))
		for i, r := range results {
			checks[i] = upgradev1alpha1.ReadinessCheckResult{
				Name:   "check",
				Result: r,
				Execution: upgradev1alpha1.CheckExecution{
					State: upgradev1alpha1.CheckCompleted,
				},
			}
		}
		return checks
	}

	It("sets Passed when all checks pass", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckPassed,
			upgradev1alpha1.CheckPassed,
		), now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckPassed))
		Expect(status.ChecksPassed).To(Equal(2))
		Expect(status.ChecksWarned).To(Equal(0))
		Expect(status.ChecksFailed).To(Equal(0))
	})

	It("sets Warning when only warnings present", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckPassed,
			upgradev1alpha1.CheckResultWarning,
			upgradev1alpha1.CheckPassed,
		), now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckResultWarning))
		Expect(status.ChecksPassed).To(Equal(2))
		Expect(status.ChecksWarned).To(Equal(1))
		Expect(status.ChecksFailed).To(Equal(0))
	})

	It("sets Failed when any check fails", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckPassed,
			upgradev1alpha1.CheckResultWarning,
			upgradev1alpha1.CheckFailed,
		), now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckFailed))
		Expect(status.ChecksFailed).To(Equal(1))
	})

	It("sets Failed when any check errors (infrastructure failure)", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckPassed,
			upgradev1alpha1.CheckResultError,
		), now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckFailed))
		Expect(status.ChecksErrored).To(Equal(1))
	})

	It("Failed takes precedence over Warning", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckResultWarning,
			upgradev1alpha1.CheckFailed,
		), now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckFailed))
	})

	It("sets Complete condition with correct reason and status=True", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(upgradev1alpha1.CheckPassed), now)
		Expect(status.Conditions).To(HaveLen(1))
		cond := status.Conditions[0]
		Expect(cond.Type).To(Equal(upgradev1alpha1.ReadinessCompleteCondition))
		Expect(cond.Status).To(Equal(metav1.ConditionTrue))
		Expect(cond.Reason).To(Equal("Passed"))
	})

	It("sets Complete condition Reason=Warning when only warnings", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(upgradev1alpha1.CheckResultWarning), now)
		Expect(status.Conditions[0].Reason).To(Equal("Warning"))
	})

	It("sets Complete condition Reason=Failed when checks fail", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(upgradev1alpha1.CheckFailed), now)
		Expect(status.Conditions[0].Reason).To(Equal("Failed"))
	})

	It("includes counts in condition message", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, makeChecks(
			upgradev1alpha1.CheckPassed,
			upgradev1alpha1.CheckResultWarning,
			upgradev1alpha1.CheckFailed,
		), now)
		Expect(status.Conditions[0].Message).To(ContainSubstring("1 passed"))
		Expect(status.Conditions[0].Message).To(ContainSubstring("1 warned"))
		Expect(status.Conditions[0].Message).To(ContainSubstring("1 failed"))
	})

	It("handles empty check list as Passed", func() {
		status := &upgradev1alpha1.UpgradeReadinessCheckStatus{}
		applyAggregates(status, nil, now)
		Expect(status.OverallResult).To(Equal(upgradev1alpha1.CheckPassed))
		Expect(status.ChecksPassed).To(Equal(0))
	})
})
